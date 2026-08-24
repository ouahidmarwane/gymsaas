import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { client, control, uniq, waitReady } from './helpers.mjs'

let scoped, orgId, ownMember, foreignMember, foreignPayment
let branchA, branchB, disciplineA, disciplineB
let ownStaffMembership, foreignStaffMembership, unrestrictedStaffMembership
let unrestrictedAdmin, branchOnlyAdmin, disciplineOnlyAdmin

before(async () => {
  const u = uniq()
  const email = `scope-${u}@example.ma`
  scoped = client()
  const signup = await scoped.call('POST', '/api/auth/signup', {
    clubName: 'Club Scope Batch 1', slug: `scope-${u}`, name: 'Scoped Owner',
    email, password: 'motdepasse-solide-scope',
  })
  assert.equal(signup.status, 201, JSON.stringify(signup.data))
  orgId = signup.data.orgId
  branchA = (await scoped.call('POST', '/api/branches', { name: 'Salle A' })).data.id
  branchB = (await scoped.call('POST', '/api/branches', { name: 'Salle B' })).data.id
  disciplineA = (await scoped.call('POST', '/api/disciplines', {
    name: 'Discipline A', grades: [{ label: 'A1' }, { label: 'A2' }],
  })).data.id
  disciplineB = (await scoped.call('POST', '/api/disciplines', {
    name: 'Discipline B', grades: [{ label: 'B1' }, { label: 'B2' }],
  })).data.id
  ownMember = (await scoped.call('POST', '/api/members', { name: 'Dans les deux portees', phone: '0611111111', branchId: branchA, disciplineId: disciplineA })).data.id
  foreignMember = (await scoped.call('POST', '/api/members', { name: 'Hors portee', phone: '0622222222', branchId: branchB, disciplineId: disciplineB })).data.id
  await scoped.call('POST', '/api/members', { name: 'Salle seulement', phone: '0633333333', branchId: branchA, disciplineId: disciplineB })
  await scoped.call('POST', '/api/members', { name: 'Discipline seulement', phone: '0644444444', branchId: branchB, disciplineId: disciplineA })
  await scoped.call('POST', '/api/payments', { memberId: ownMember, amountCents: 1000, type: 'monthly', method: 'cash' })
  foreignPayment = (await scoped.call('POST', '/api/payments', { memberId: foreignMember, amountCents: 9000, type: 'monthly', method: 'cash' })).data.id

  const staffRows = []
  for (const [name, suffix] of [
    ['Staff A', 'a'], ['Staff B', 'b'], ['Staff Global', 'g'],
    ['Staff Branche', 'branch'], ['Staff Discipline', 'discipline'],
  ]) {
    const email = `staff-${suffix}-${u}@example.ma`
    assert.equal((await scoped.call('POST', '/api/staff', {
      name, email, password: 'motdepasse-solide-staff', role: 'admin',
    })).status, 201)
    staffRows.push({ email, suffix })
  }
  const allStaff = (await scoped.call('GET', '/api/staff')).data.staff
  ownStaffMembership = allStaff.find(s => s.email === staffRows[0].email).membership_id
  foreignStaffMembership = allStaff.find(s => s.email === staffRows[1].email).membership_id
  unrestrictedStaffMembership = allStaff.find(s => s.email === staffRows[2].email).membership_id
  const branchOnlyMembership = allStaff.find(s => s.email === staffRows[3].email).membership_id
  const disciplineOnlyMembership = allStaff.find(s => s.email === staffRows[4].email).membership_id
  control(`UPDATE memberships SET branch_id = '${branchA}', discipline_id = '${disciplineA}' WHERE id = '${ownStaffMembership}'`)
  control(`UPDATE memberships SET branch_id = '${branchB}', discipline_id = '${disciplineB}' WHERE id = '${foreignStaffMembership}'`)
  control(`UPDATE memberships SET branch_id = '${branchA}', discipline_id = NULL WHERE id = '${branchOnlyMembership}'`)
  control(`UPDATE memberships SET branch_id = NULL, discipline_id = '${disciplineA}' WHERE id = '${disciplineOnlyMembership}'`)
  control(`UPDATE memberships SET branch_id = '${branchA}', discipline_id = '${disciplineA}' WHERE org_id = '${orgId}' AND user_id = (SELECT id FROM users WHERE email_norm = '${email}')`)
  await waitReady()
  unrestrictedAdmin = client()
  branchOnlyAdmin = client()
  disciplineOnlyAdmin = client()
  assert.equal((await unrestrictedAdmin.call('POST', '/api/auth/login', {
    email: staffRows[2].email, password: 'motdepasse-solide-staff',
  })).status, 200)
  assert.equal((await branchOnlyAdmin.call('POST', '/api/auth/login', {
    email: staffRows[3].email, password: 'motdepasse-solide-staff',
  })).status, 200)
  assert.equal((await disciplineOnlyAdmin.call('POST', '/api/auth/login', {
    email: staffRows[4].email, password: 'motdepasse-solide-staff',
  })).status, 200)
})

test('les portees salle et discipline s appliquent par intersection aux lectures', async () => {
  const members = await scoped.call('GET', '/api/members')
  assert.equal(members.status, 200, JSON.stringify(members.data))
  assert.deepEqual(members.data.members.map(m => m.id), [ownMember])
  const bypass = await scoped.call('GET', `/api/members?disciplineId=${disciplineB}`)
  assert.deepEqual(bypass.data.members, [])
  assert.deepEqual((await scoped.call('GET', '/api/branches')).data.branches.map(b => b.id), [branchA])
  assert.deepEqual((await scoped.call('GET', '/api/disciplines')).data.disciplines.map(d => d.id), [disciplineA])
  const dashboard = await scoped.call('GET', '/api/dashboard/stats')
  assert.equal(dashboard.data.stats.membersTotal, 1)
  assert.equal(dashboard.data.stats.revenueMonthCents, 1000)
  const payments = await scoped.call('GET', '/api/payments')
  assert.equal(payments.data.payments.length, 1)
  assert.equal(payments.data.payments[0].member_id, ownMember)
})

test('les portees branche seule, discipline seule et NULL restent distinctes', async () => {
  const byBranch = (await branchOnlyAdmin.call('GET', '/api/members')).data.members.map(m => m.name).sort()
  assert.deepEqual(byBranch, ['Dans les deux portees', 'Salle seulement'])
  const byDiscipline = (await disciplineOnlyAdmin.call('GET', '/api/members')).data.members.map(m => m.name).sort()
  assert.deepEqual(byDiscipline, ['Dans les deux portees', 'Discipline seulement'])
  const unrestricted = (await unrestrictedAdmin.call('GET', '/api/members')).data.members.map(m => m.name)
  assert.ok(unrestricted.includes('Hors portee'))
  assert.ok(unrestricted.includes('Salle seulement'))
  assert.ok(unrestricted.includes('Discipline seulement'))
})

test('les identifiants controles par le client ne permettent pas de sortir de la portee', async () => {
  assert.equal((await scoped.call('PATCH', `/api/members/${foreignMember}`, { name: 'Intrusion' })).status, 403)
  assert.equal((await scoped.call('DELETE', `/api/members/${foreignMember}`)).status, 403)
  assert.equal((await scoped.call('POST', '/api/payments', { memberId: foreignMember, amountCents: 1000, type: 'monthly' })).status, 403)
  assert.equal((await scoped.call('GET', `/api/members/${foreignMember}/document`)).status, 403)
  assert.equal((await scoped.call('GET', `/api/members/${foreignMember}/photo`)).status, 403)
  assert.equal((await scoped.call('POST', `/api/payments/${foreignPayment}/reverse`, {
    kind: 'erreur', reason: 'tentative hors portee',
  })).status, 403)
  assert.equal((await scoped.call('POST', `/api/members/${foreignMember}/renew`, { months: 1 })).status, 403)
  assert.equal((await scoped.call('POST', `/api/members/${foreignMember}/insurance`, { months: 12 })).status, 403)
  assert.equal((await scoped.call('POST', '/api/branches', { name: 'Evasion' })).status, 403)
  assert.equal((await scoped.call('POST', '/api/disciplines', { name: 'Evasion', hasGrading: false })).status, 403)
})

test('un admin restreint ne peut ni enumerer ni administrer le personnel etendu', async () => {
  const staff = await scoped.call('GET', '/api/staff')
  assert.equal(staff.status, 200)
  assert.ok(staff.data.staff.some(s => s.membership_id === ownStaffMembership))
  assert.ok(!staff.data.staff.some(s => s.membership_id === foreignStaffMembership))
  assert.ok(!staff.data.staff.some(s => s.membership_id === unrestrictedStaffMembership))
  assert.equal((await scoped.call('PATCH', `/api/staff/${foreignStaffMembership}`, { role: 'viewer' })).status, 404)
  assert.equal((await scoped.call('DELETE', `/api/staff/${foreignStaffMembership}`)).status, 404)
  assert.equal((await scoped.call('PATCH', `/api/staff/${unrestrictedStaffMembership}`, { role: 'viewer' })).status, 404)
  assert.equal((await scoped.call('PATCH', `/api/staff/${ownStaffMembership}`, { role: 'staff' })).status, 200)
  const email = `staff-created-${uniq()}@example.ma`
  assert.equal((await scoped.call('POST', '/api/staff', {
    name: 'Staff cree borne', email, password: 'motdepasse-solide-staff', role: 'staff',
  })).status, 201)
  const created = (await scoped.call('GET', '/api/staff')).data.staff.find(s => s.email === email)
  assert.equal(created.branch_id, branchA)
  assert.equal(created.discipline_id, disciplineA)
})

test('un administrateur sans portee conserve la gestion du club entier', async () => {
  const staff = await unrestrictedAdmin.call('GET', '/api/staff')
  assert.equal(staff.status, 200)
  assert.ok(staff.data.staff.some(s => s.membership_id === foreignStaffMembership))
  assert.equal((await unrestrictedAdmin.call('PATCH', `/api/staff/${foreignStaffMembership}`, {
    role: 'staff',
  })).status, 200)
})

test('le journal et les metadonnees de grades respectent la portee serveur', async () => {
  const audit = await scoped.call('GET', '/api/audit')
  assert.equal(audit.status, 200)
  assert.ok(audit.data.entries.some(e => e.entity_name === 'Dans les deux portees'))
  assert.ok(!audit.data.entries.some(e => JSON.stringify(e).includes('Hors portee')))
  const grades = await scoped.call('GET', '/api/grades')
  assert.equal(grades.status, 200, JSON.stringify(grades.data))
  assert.deepEqual(Object.keys(grades.data.ladders), [disciplineA])
})

test('l import ne peut pas elargir la portee authentifiee', async () => {
  const imported = await scoped.call('POST', '/api/members/import', { rows: [{
    name: 'Import borne', phone: '0666666666', branchId: branchB, disciplineId: disciplineB,
  }] })
  assert.equal(imported.status, 201)
  const row = (await scoped.call('GET', '/api/members')).data.members.find(m => m.name === 'Import borne')
  assert.equal(row.branch_id, branchA)
  assert.equal(row.discipline_id, disciplineA)
})

test('les creations et mutations restent dans les deux portees', async () => {
  assert.equal((await scoped.call('POST', '/api/members', { name: 'Creation refusee', phone: '0655555554', branchId: branchB, disciplineId: disciplineB })).status, 403)
  const created = await scoped.call('POST', '/api/members', { name: 'Creation bornee', phone: '0655555555' })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  const row = (await scoped.call('GET', '/api/members')).data.members.find(m => m.id === created.data.id)
  assert.equal(row.branch_id, branchA)
  assert.equal(row.discipline_id, disciplineA)
  assert.equal((await scoped.call('PATCH', `/api/members/${ownMember}`, { branchId: branchB })).status, 403)
})
