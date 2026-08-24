import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { ClubDatabase } from '../src/club/club-database.ts'
import { MIGRATIONS, LATEST_VERSION } from '../src/club/schema.ts'
import { evaluateEntitlement } from '../src/api.ts'

// Real DO State simulator backed by real SQLite database
async function createRealClub(db = new DatabaseSync(':memory:'), runMigrate = true) {
  let migrationPromise = null

  const sql = {
    exec(query, ...params) {
      const trimmed = query.trim()
      const isSelect = /^(SELECT|WITH|PRAGMA)\b/i.test(trimmed)

      if (isSelect) {
        const stmt = db.prepare(query)
        const rows = stmt.all(...params)
        return {
          toArray: () => rows,
          one: () => {
            if (rows.length === 0) throw new Error('Query returned no rows')
            return rows[0]
          },
          raw: () => rows.map(r => Object.values(r)),
        }
      } else {
        if (params.length === 0) {
          db.exec(query)
        } else {
          db.prepare(query).run(...params)
        }
        return {
          toArray: () => [],
          one: () => { throw new Error('No rows returned') },
          raw: () => [],
        }
      }
    }
  }

  const storage = {
    sql,
    transactionSync(callback) {
      db.exec('BEGIN IMMEDIATE TRANSACTION')
      try {
        const result = callback()
        db.exec('COMMIT')
        return result
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    }
  }

  const ctx = {
    storage,
    blockConcurrencyWhile(cb) {
      if (runMigrate) {
        migrationPromise = cb()
      }
    },
  }

  const club = new ClubDatabase(ctx, {})
  if (migrationPromise) {
    await migrationPromise
  }

  return { club, db, ctx }
}

// -----------------------------------------------------------------------------
// PART 1: M-03 PRODUCTION DO MIGRATION ATOMICITY & MATRIX
// -----------------------------------------------------------------------------

test('M-03 Production: Clean bootstrap to LATEST_VERSION', async () => {
  const { club } = await createRealClub()
  assert.equal(club.schemaVersion(), LATEST_VERSION)
  assert.equal(club.isConfigured(), false)
})

test('M-03 Production: Historical migration upgrade matrix (V1..V11)', async () => {
  for (let startV = 0; startV <= LATEST_VERSION; startV++) {
    const db = new DatabaseSync(':memory:')
    db.exec("CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")

    // Pre-apply migrations up to startV
    for (const m of MIGRATIONS.filter(m => m.version <= startV)) {
      for (const s of m.statements) db.exec(s)
      db.prepare('INSERT INTO _schema_version (version) VALUES (?)').run(m.version)
    }

    // Instantiating ClubDatabase runs production migrate()
    const { club } = await createRealClub(db)
    assert.equal(club.schemaVersion(), LATEST_VERSION, `Upgrade from V${startV} to V${LATEST_VERSION} failed`)
  }
})

test('M-03 Production: Fault injection rollback in transactionSync (no dirty schema)', async () => {
  const db = new DatabaseSync(':memory:')
  db.exec("CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")

  // Apply V1..V2 manually
  for (const m of MIGRATIONS.filter(m => m.version <= 2)) {
    for (const s of m.statements) db.exec(s)
    db.prepare('INSERT INTO _schema_version (version) VALUES (?)').run(m.version)
  }

  // Create DO without auto-running migrate
  const { ctx } = await createRealClub(db, false)
  let threw = false

  try {
    ctx.storage.transactionSync(() => {
      ctx.storage.sql.exec('CREATE TABLE test_fault_table (id TEXT PRIMARY KEY)')
      ctx.storage.sql.exec('SYNTAX ERROR INVALID SQL STATEMENT')
      ctx.storage.sql.exec('INSERT INTO _schema_version (version) VALUES (3)')
    })
  } catch (err) {
    threw = true
  }

  assert.ok(threw, 'Fault injection must throw')
  // Verify test_fault_table was rolled back and _schema_version remains 2
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  assert.ok(!tables.includes('test_fault_table'), 'Table created in failed transaction must be rolled back')
  const v = db.prepare('SELECT MAX(version) AS v FROM _schema_version').get()?.v
  assert.equal(v, 2, 'Version must remain 2 after failed transaction')
})

// -----------------------------------------------------------------------------
// PART 2: L-05 PRODUCTION DYNAMIC SET & NULL SEMANTICS
// -----------------------------------------------------------------------------

test('L-05 Production updateBranch: Dynamic allowlisted SET distinguishes undefined vs null', async () => {
  const { club, db } = await createRealClub()

  const { id } = club.addBranch({
    name: 'Main Dojo',
    nameAr: 'الفرع الرئيسي',
    address: '123 Avenue Mohammed V',
  })

  let branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(id)
  assert.equal(branch.name, 'Main Dojo')
  assert.equal(branch.name_ar, 'الفرع الرئيسي')
  assert.equal(branch.address, '123 Avenue Mohammed V')

  // 1. Partial update: change name only -> nameAr and address PRESERVED
  club.updateBranch(id, { name: 'Main Dojo VIP' })
  branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(id)
  assert.equal(branch.name, 'Main Dojo VIP')
  assert.equal(branch.name_ar, 'الفرع الرئيسي')
  assert.equal(branch.address, '123 Avenue Mohammed V')

  // 2. Explicit null for address -> address CLEARED to NULL
  club.updateBranch(id, { address: null })
  branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(id)
  assert.equal(branch.name, 'Main Dojo VIP')
  assert.equal(branch.name_ar, 'الفرع الرئيسي')
  assert.equal(branch.address, null)

  // 3. Explicit null for nameAr -> name_ar CLEARED to NULL
  club.updateBranch(id, { nameAr: null })
  branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(id)
  assert.equal(branch.name_ar, null)

  // 4. Empty update object -> safe no-op
  club.updateBranch(id, {})
  branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(id)
  assert.equal(branch.name, 'Main Dojo VIP')

  // 5. Parameterization safety with special characters
  club.updateBranch(id, { name: "Robert'); DROP TABLE branches;--" })
  branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(id)
  assert.equal(branch.name, "Robert'); DROP TABLE branches;--")
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  assert.ok(tables.includes('branches'), 'Table must not be dropped by SQL injection test string')
})

test('L-05 Production updateMember: Dynamic allowlisted SET clears nullable fields', async () => {
  const { club, db } = await createRealClub()

  const { id: branchId } = club.addBranch({ name: 'Branch 1' })
  const { id: discId } = club.addDiscipline({ name: 'Karate', hasGrading: false })

  const { id } = club.addMember({
    name: 'Youssef El Amrani',
    phone: '0611223344',
    email: 'youssef@example.com',
    branchId,
    disciplineId: discId,
    subExpiry: '2026-12-31',
    insExpiry: '2026-12-31',
    joinDate: '2026-01-01',
    isInsured: true,
  })

  // Add notes
  club.updateMember(id, { notes: 'Competition team' })
  let member = club.getMember(id)
  assert.equal(member.notes, 'Competition team')
  assert.equal(member.email, 'youssef@example.com')
  assert.equal(member.branch_id, branchId)

  // 1. Clear email with explicit null -> email cleared, notes & branch preserved
  club.updateMember(id, { email: null })
  member = club.getMember(id)
  assert.equal(member.email, null)
  assert.equal(member.notes, 'Competition team')
  assert.equal(member.branch_id, branchId)

  // 2. Clear branchId and disciplineId with explicit null
  club.updateMember(id, { branchId: null, disciplineId: null })
  member = club.getMember(id)
  assert.equal(member.branch_id, null)
  assert.equal(member.discipline_id, null)

  // 3. Clear subExpiry, insExpiry, and notes with explicit null
  club.updateMember(id, { subExpiry: null, insExpiry: null, notes: null })
  member = club.getMember(id)
  assert.equal(member.sub_expiry, null)
  assert.equal(member.ins_expiry, null)
  assert.equal(member.notes, null)

  // 4. Update isInsured to false -> set to 0
  club.updateMember(id, { isInsured: false })
  member = club.getMember(id)
  assert.equal(member.is_insured, 0)

  // 5. Update status to inactive
  club.updateMember(id, { status: 'inactive' })
  member = club.getMember(id)
  assert.equal(member.status, 'inactive')

  // 6. Parameterization safety with quotes and special characters
  club.updateMember(id, { name: "O'Connor \"Admin\" <script>" })
  member = club.getMember(id)
  assert.equal(member.name, "O'Connor \"Admin\" <script>")
})

// -----------------------------------------------------------------------------
// PART 3: M-05 PRODUCTION SAAS ENTITLEMENT & FAIL-CLOSED BEHAVIOR
// -----------------------------------------------------------------------------

function createMockControl(orgRows = {}) {
  return {
    prepare(query) {
      return {
        bind(...params) {
          return {
            first: async () => {
              const orgId = params[0]
              return orgRows[orgId] ?? null
            },
            all: async () => ({ results: [] }),
            run: async () => ({}),
          }
        }
      }
    }
  }
}

test('M-05 Production evaluateEntitlement: State machine & fail-closed on invalid data', async () => {
  const env = {
    CONTROL: createMockControl({
      'org-active-trial': {
        id: 'org-active-trial', status: 'active', plan: 'trial',
        trial_ends_at: '2026-12-31T00:00:00Z', max_members: 50, max_branches: 1, max_staff: 2,
        expires_at: null, price_cents: null
      },
      'org-grace-trial': {
        id: 'org-grace-trial', status: 'active', plan: 'trial',
        trial_ends_at: '2026-08-20T00:00:00Z', max_members: 50, max_branches: 1, max_staff: 2,
        expires_at: null, price_cents: null
      },
      'org-expired-trial': {
        id: 'org-expired-trial', status: 'active', plan: 'trial',
        trial_ends_at: '2026-08-01T00:00:00Z', max_members: 50, max_branches: 1, max_staff: 2,
        expires_at: null, price_cents: null
      },
      'org-active-paid': {
        id: 'org-active-paid', status: 'active', plan: 'club',
        trial_ends_at: null, max_members: 500, max_branches: 3, max_staff: 10,
        expires_at: '2026-12-31T00:00:00Z', price_cents: 49000
      },
      'org-suspended': {
        id: 'org-suspended', status: 'suspended', plan: 'club',
        trial_ends_at: null, max_members: 500, max_branches: 3, max_staff: 10,
        expires_at: '2026-12-31T00:00:00Z', price_cents: 49000
      },
      'org-cancelled': {
        id: 'org-cancelled', status: 'cancelled', plan: 'club',
        trial_ends_at: null, max_members: 500, max_branches: 3, max_staff: 10,
        expires_at: '2026-12-31T00:00:00Z', price_cents: 49000
      },
      'org-deleting': {
        id: 'org-deleting', status: 'deleting', plan: 'club',
        trial_ends_at: null, max_members: 500, max_branches: 3, max_staff: 10,
        expires_at: '2026-12-31T00:00:00Z', price_cents: 49000
      },
      'org-deleted': {
        id: 'org-deleted', status: 'deleted', plan: 'club',
        trial_ends_at: null, max_members: 500, max_branches: 3, max_staff: 10,
        expires_at: '2026-12-31T00:00:00Z', price_cents: 49000
      },
      'org-paid-missing-billing': {
        id: 'org-paid-missing-billing', status: 'active', plan: 'club',
        trial_ends_at: null, max_members: 500, max_branches: 3, max_staff: 10,
        expires_at: null, price_cents: null
      },
      'org-trial-missing-date': {
        id: 'org-trial-missing-date', status: 'active', plan: 'trial',
        trial_ends_at: null, max_members: 50, max_branches: 1, max_staff: 2,
        expires_at: null, price_cents: null
      },
      'org-unknown-plan': {
        id: 'org-unknown-plan', status: 'active', plan: 'super_vip',
        trial_ends_at: null, max_members: null, max_branches: null, max_staff: null,
        expires_at: '2026-12-31T00:00:00Z', price_cents: 99000
      },
      'org-unknown-status': {
        id: 'org-unknown-status', status: 'banned_custom', plan: 'club',
        trial_ends_at: null, max_members: null, max_branches: null, max_staff: null,
        expires_at: '2026-12-31T00:00:00Z', price_cents: 49000
      },
    })
  }

  // 1. Active trial
  const res1 = await evaluateEntitlement(env, 'org-active-trial')
  assert.equal(res1.state, 'trial')
  assert.equal(res1.readOnly, false)

  // 2. Grace trial (within 7 days)
  const res2 = await evaluateEntitlement(env, 'org-grace-trial')
  assert.equal(res2.state, 'grace')
  assert.equal(res2.readOnly, false)

  // 3. Expired trial (> 7 days)
  const res3 = await evaluateEntitlement(env, 'org-expired-trial')
  assert.equal(res3.state, 'expired')
  assert.equal(res3.readOnly, true)

  // 4. Active paid
  const res4 = await evaluateEntitlement(env, 'org-active-paid')
  assert.equal(res4.state, 'active')
  assert.equal(res4.readOnly, false)

  // 5. Suspended
  const res5 = await evaluateEntitlement(env, 'org-suspended')
  assert.equal(res5.state, 'suspended')
  assert.equal(res5.readOnly, true)

  // 6. Cancelled
  const res6 = await evaluateEntitlement(env, 'org-cancelled')
  assert.equal(res6.state, 'cancelled')
  assert.equal(res6.readOnly, true)

  // 7. Deleting
  const res7 = await evaluateEntitlement(env, 'org-deleting')
  assert.equal(res7.state, 'deleting')
  assert.equal(res7.readOnly, true)

  // 8. Deleted
  const res8 = await evaluateEntitlement(env, 'org-deleted')
  assert.equal(res8.state, 'deleted')
  assert.equal(res8.readOnly, true)

  // 9. FAIL-CLOSED: Paid plan with missing billing row -> readOnly: true, expired
  const res9 = await evaluateEntitlement(env, 'org-paid-missing-billing')
  assert.equal(res9.state, 'expired')
  assert.equal(res9.readOnly, true)

  // 10. FAIL-CLOSED: Trial with missing trial_ends_at -> readOnly: true, expired
  const res10 = await evaluateEntitlement(env, 'org-trial-missing-date')
  assert.equal(res10.state, 'expired')
  assert.equal(res10.readOnly, true)

  // 11. FAIL-CLOSED: Unknown plan -> readOnly: true, expired
  const res11 = await evaluateEntitlement(env, 'org-unknown-plan')
  assert.equal(res11.state, 'expired')
  assert.equal(res11.readOnly, true)

  // 12. FAIL-CLOSED: Unknown status -> readOnly: true, expired
  const res12 = await evaluateEntitlement(env, 'org-unknown-status')
  assert.equal(res12.state, 'expired')
  assert.equal(res12.readOnly, true)
})
