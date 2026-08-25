'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Bell, Check, ChevronDown, Hash, Info, LoaderCircle, MessageCircle,
  FileText, Link2, MoreHorizontal, Paperclip, Plus, Reply, Search,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Send, ShieldCheck, SmilePlus, Users, X,
} from 'lucide-react'
import { api, ApiError, upload, type Me } from '@/lib/client'

type Conversation = {
  id: string; type: 'dm' | 'group' | 'team'; name: string; description: string | null
  last_body: string | null; last_at: string | null; updated_at: string; unread: number
}
type Person = { id: string; name: string; role: string }
type Member = { id: string; name: string; role: string | null; isAdmin: number }
type Message = {
  id: string; authorId: string; authorName: string; body: string; createdAt: string
  replyToId: string | null; replyBody: string | null; replyAuthor: string | null
  mentions: string[]; reactions: Array<{ emoji: string; count: number; reacted: number }>
  attachments: Attachment[]
}
type Attachment = { id: string; fileName: string; contentType: string; sizeBytes: number; kind: 'image' | 'file' }
type Announcement = {
  id: string; title: string; content: string; status: string; publishedAt: string | null
  createdAt: string; publisherName: string | null; isRead: number
  reactions: Array<{ emoji: string; count: number; reacted: number }>
}
type SupportThread = { id: string; orgId: string; orgName: string; updatedAt: string; lastBody: string | null; unread: number }
type SupportMessage = { id: string; authorId: string; authorName: string; authorKind: 'club' | 'support'; body: string; createdAt: string }
type GroupInfo = { id: string; type: string; name: string | null; members: Member[] }

const EMOJIS = ['👍', '❤️', '😂', '👏']
const REFRESH_MS = 8_000
const ANNOUNCEMENT_POLL_MS = 60_000
const ANNOUNCEMENT_REMINDER_MS = 60 * 60 * 1_000
const ANNOUNCEMENT_REMINDER_KEY = 'gymflow:announcement-reminders'

export default function MessagingPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [supportThreads, setSupportThreads] = useState<SupportThread[]>([])
  const [active, setActive] = useState<{ kind: 'conversation' | 'support' | 'announcements'; id?: string } | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [hasOlder, setHasOlder] = useState(false)
  const [supportMessages, setSupportMessages] = useState<SupportMessage[]>([])
  const [info, setInfo] = useState<{ id: string; type: string; name: string | null; members: Member[] } | null>(null)
  const [search, setSearch] = useState('')
  const [conversationFilter, setConversationFilter] = useState<'all' | 'groups'>('all')
  const [loading, setLoading] = useState(true)
  const [loadingChat, setLoadingChat] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [composer, setComposer] = useState('')
  const [mentionIds, setMentionIds] = useState<string[]>([])
  const [reply, setReply] = useState<Message | null>(null)
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [newDialog, setNewDialog] = useState<'dm' | 'group' | null>(null)
  const [announcementNotice, setAnnouncementNotice] = useState<Announcement | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const didAutoSelect = useRef(false)

  const clubMessaging = me?.scope.mode === 'member' && ['owner', 'admin', 'staff'].includes(me.org?.role ?? '')
  const platformMessaging = Boolean(me?.isPlatformAdmin && me.scope.mode !== 'support')
  const canUseSupport = platformMessaging || ['owner', 'admin', 'staff'].includes(me?.org?.role ?? '')

  const loadNavigation = useCallback(async (identity: Me) => {
    const platformContext = identity.isPlatformAdmin && identity.scope.mode !== 'support'
    const jobs: Promise<void>[] = [
      api.get<{ announcements: Announcement[] }>(`/api/messaging/announcements${platformContext ? '?manage=1' : ''}`)
        .then(data => setAnnouncements(data.announcements)),
    ]
    if (identity.scope.mode === 'member' && ['owner', 'admin', 'staff'].includes(identity.org?.role ?? '')) {
      jobs.push(
        api.get<{ conversations: Conversation[] }>('/api/messaging/conversations')
          .then(data => setConversations(data.conversations)),
        api.get<{ people: Person[] }>('/api/messaging/participants')
          .then(data => setPeople(data.people)),
      )
    }
    if (platformContext || ['owner', 'admin', 'staff'].includes(identity.org?.role ?? '')) {
      jobs.push(api.get<{ threads: SupportThread[] }>('/api/messaging/support/threads')
        .then(data => setSupportThreads(data.threads)))
    }
    await Promise.all(jobs)
  }, [])

  useEffect(() => {
    let alive = true
    api.get<Me>('/api/me').then(async identity => {
      if (!alive) return
      setMe(identity)
      await loadNavigation(identity)
    }).catch(e => setError(messageOf(e))).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [loadNavigation])

  const loadConversation = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setLoadingChat(true)
    try {
      const [history, details] = await Promise.all([
        api.get<{ messages: Message[]; hasMore: boolean }>(`/api/messaging/conversations/${encodeURIComponent(id)}/messages`),
        api.get<{ id: string; type: string; name: string | null; members: Member[] }>(
          `/api/messaging/conversations/${encodeURIComponent(id)}`,
        ),
      ])
      setMessages(history.messages)
      setHasOlder(history.hasMore)
      setInfo(details)
      await api.post(`/api/messaging/conversations/${encodeURIComponent(id)}/read`)
      setConversations(current => current.map(c => c.id === id ? { ...c, unread: 0 } : c))
    } catch (e) { if (!quiet) setError(messageOf(e)) }
    finally { if (!quiet) setLoadingChat(false) }
  }, [])

  const loadSupport = useCallback(async (orgId?: string, quiet = false) => {
    if (!quiet) setLoadingChat(true)
    try {
      const suffix = orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''
      const data = await api.get<{ messages: SupportMessage[] }>(`/api/messaging/support${suffix}`)
      setSupportMessages(data.messages)
    } catch (e) { if (!quiet) setError(messageOf(e)) }
    finally { if (!quiet) setLoadingChat(false) }
  }, [])

  useEffect(() => {
    if (!active) return
    if (active.kind === 'conversation' && active.id) void loadConversation(active.id)
    if (active.kind === 'support') void loadSupport(active.id)
  }, [active, loadConversation, loadSupport])

  useEffect(() => {
    if (!active || active.kind === 'announcements') return
    const timer = setInterval(() => {
      if (active.kind === 'conversation' && active.id) void loadConversation(active.id, true)
      if (active.kind === 'support') void loadSupport(active.id, true)
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [active, loadConversation, loadSupport])

  useEffect(() => {
    if (!me) return
    const timer = window.setInterval(() => {
      const manage = me.isPlatformAdmin && me.scope.mode !== 'support' ? '?manage=1' : ''
      void api.get<{ announcements: Announcement[] }>(`/api/messaging/announcements${manage}`)
        .then(data => setAnnouncements(data.announcements))
        .catch(() => undefined)
    }, ANNOUNCEMENT_POLL_MS)
    return () => window.clearInterval(timer)
  }, [me])

  useEffect(() => {
    if (!me || me.isPlatformAdmin) {
      setAnnouncementNotice(null)
      return
    }
    const unread = announcements
      .filter(item => !item.isRead && item.status === 'published')
      .sort((a, b) => Date.parse(b.publishedAt ?? b.createdAt) - Date.parse(a.publishedAt ?? a.createdAt))
    if (unread.length === 0) {
      setAnnouncementNotice(null)
      return
    }
    const remind = () => {
      const item = unread[0]!
      let reminders: Record<string, number> = {}
      try { reminders = JSON.parse(window.localStorage.getItem(ANNOUNCEMENT_REMINDER_KEY) ?? '{}') as Record<string, number> } catch { reminders = {} }
      const lastShown = reminders[item.id] ?? 0
      if (Date.now() - lastShown < ANNOUNCEMENT_REMINDER_MS) return
      setAnnouncementNotice(item)
      reminders[item.id] = Date.now()
      try { window.localStorage.setItem(ANNOUNCEMENT_REMINDER_KEY, JSON.stringify(reminders)) } catch { /* stockage indisponible : le rappel reste fonctionnel pendant la session */ }
    }
    remind()
    const timer = window.setInterval(remind, 60_000)
    return () => window.clearInterval(timer)
  }, [announcements, me])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, supportMessages])

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('fr')
    return conversations.filter(c => {
      const matchesKind = conversationFilter === 'all'
        || (conversationFilter === 'groups' && ['group', 'team'].includes(c.type))
      return matchesKind && (!q || c.name.toLocaleLowerCase('fr').includes(q)
        || c.last_body?.toLocaleLowerCase('fr').includes(q))
    })
  }, [conversationFilter, conversations, search])

  useEffect(() => {
    if (didAutoSelect.current || active || conversations.length === 0) return
    if (window.matchMedia('(min-width: 681px)').matches) {
      didAutoSelect.current = true
      setActive({ kind: 'conversation', id: conversations[0]!.id })
    }
  }, [active, conversations])

  const mentionCandidates = useMemo(() => {
    if (!composer.match(/(?:^|\s)@[\p{L}\p{N} '-]*$/u)) return []
    if (info?.type === 'team') return people
    return (info?.members ?? []).map(member => ({ id: member.id, name: member.name, role: member.role ?? '' }))
      .filter(person => person.id !== me?.user.id)
  }, [composer, info, me?.user.id, people])

  async function send() {
    const body = composer.trim()
    if (!body || sending || !active) return
    setSending(true); setError(null)
    try {
      if (active.kind === 'conversation' && active.id) {
        await api.post(`/api/messaging/conversations/${encodeURIComponent(active.id)}/messages`, {
          body, mentionIds, replyToId: reply?.id ?? null,
        })
        setComposer(''); setMentionIds([]); setReply(null)
        await loadConversation(active.id, true)
        if (me) await loadNavigation(me)
      } else if (active.kind === 'support') {
        await api.post('/api/messaging/support', { body, ...(me?.isPlatformAdmin ? { orgId: active.id } : {}) })
        setComposer(''); await loadSupport(active.id, true)
      }
    } catch (e) { setError(messageOf(e)) }
    finally { setSending(false) }
  }

  async function react(messageId: string, emoji: string) {
    if (active?.kind !== 'conversation' || !active.id) return
    await api.post(`/api/messaging/conversations/${encodeURIComponent(active.id)}/messages/${encodeURIComponent(messageId)}/reactions`, { emoji })
    await loadConversation(active.id, true)
  }

  async function attach(file: File) {
    if (active?.kind !== 'conversation' || !active.id || uploading) return
    setUploading(true); setError(null)
    try {
      await upload('PUT', `/api/messaging/conversations/${encodeURIComponent(active.id)}/attachments?name=${encodeURIComponent(file.name)}`, file)
      await loadConversation(active.id, true)
      if (me) await loadNavigation(me)
    } catch (e) { setError(messageOf(e)) }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }

  async function loadOlder() {
    if (active?.kind !== 'conversation' || !active.id || !messages[0]) return
    const first = messages[0]
    setLoadingChat(true)
    try {
      const data = await api.get<{ messages: Message[]; hasMore: boolean }>(
        `/api/messaging/conversations/${encodeURIComponent(active.id)}/messages?beforeAt=${encodeURIComponent(first.createdAt)}&beforeId=${encodeURIComponent(first.id)}`,
      )
      setMessages(current => [...data.messages, ...current])
      setHasOlder(data.hasMore)
    } catch (e) { setError(messageOf(e)) }
    finally { setLoadingChat(false) }
  }

  async function consultAnnouncement(item: Announcement) {
    setAnnouncementNotice(null)
    setActive({ kind: 'announcements' })
    if (!item.isRead && item.status === 'published') {
      try {
        await api.post(`/api/messaging/announcements/${encodeURIComponent(item.id)}/read`)
        setAnnouncements(current => current.map(row => row.id === item.id ? { ...row, isRead: 1 } : row))
      } catch (e) { setError(messageOf(e)) }
    }
  }

  const selectedConversation = conversations.find(c => c.id === active?.id)
  const showList = !active

  return (
    <div className="messaging-page">
      <span className="impeccable-contract" aria-hidden="true" dangerouslySetInnerHTML={{ __html: '<!-- THESIS: Adaptive Conversation Hub makes club communication immediately scannable and refuses dashboard cards. OWN-WORLD: GymFlow theme tokens, cobalt live states, flat layered panels, crisp dividers, restrained soft depth. STORY: Find a conversation, read and respond in one dominant thread, open context only when needed. FIRST VIEWPORT: Collapsible conversation navigator left, broad chronological thread and docked composer center, collapsible Activity panel right. FORM: Adaptive three-panel workspace, approved concept A, seed 5f631f8e. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance -->' }} />
      <header className="messaging-titlebar">
        <div>
          <p className="eyebrow">Communication</p>
          <h1>Messagerie</h1>
          <p>Les échanges de votre club, le support et les nouvelles GymFlow.</p>
        </div>
        {clubMessaging && (
          <div className="messaging-title-actions">
            <button className="btn-ghost" onClick={() => setNewDialog('dm')}><MessageCircle size={16} /> Nouveau message</button>
            <button className="btn-dark" onClick={() => setNewDialog('group')}><Users size={16} /> Créer un groupe</button>
          </div>
        )}
      </header>

      {error && <div className="messaging-error" role="alert"><span>{error}</span><button onClick={() => setError(null)} aria-label="Fermer"><X size={16} /></button></div>}

      {announcementNotice && !me?.isPlatformAdmin && <aside className="announcement-notice" role="status" aria-live="assertive" aria-label="Nouvelle annonce GymFlow">
        <span className="announcement-notice-icon"><Bell size={18} /></span>
        <span><b>Nouvelle annonce GymFlow</b><strong>{announcementNotice.title}</strong><small>Un nouveau message officiel vous attend.</small></span>
        <button className="announcement-notice-open" onClick={() => void consultAnnouncement(announcementNotice)}>Consulter</button>
        <button className="announcement-notice-close" onClick={() => setAnnouncementNotice(null)} aria-label="Fermer le rappel"><X size={16} /></button>
      </aside>}

      <section className={`messaging-shell${showList ? '' : ' has-active'}${active && detailsOpen ? ' has-details' : ''}${sidebarOpen ? '' : ' sidebar-collapsed'}`} aria-label="Centre de messagerie">
        <aside className="messaging-sidebar">
          <div className="messaging-sidebar-head">
            <div className="recent-title"><h2>Messages récents</h2><ChevronDown size={17} /></div>
            <div className="sidebar-create-actions"><button onClick={() => setSidebarOpen(value => !value)} aria-label={sidebarOpen ? 'Réduire les conversations' : 'Afficher les conversations'} title={sidebarOpen ? 'Réduire les conversations' : 'Afficher les conversations'}>{sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</button>{clubMessaging && <><button onClick={() => setNewDialog('dm')} aria-label="Nouveau message"><MessageCircle size={16} /></button><button onClick={() => setNewDialog('group')} aria-label="Créer un groupe"><Plus size={17} /></button></>}</div>
          </div>
          {clubMessaging && <div className="conversation-filters" aria-label="Filtrer les conversations">{([
            ['all', 'Chat'], ['groups', 'Groupes'],
          ] as const).map(([value, label]) => <button key={value} className={conversationFilter === value ? 'active' : ''} onClick={() => setConversationFilter(value)}>{label}</button>)}</div>}
          <div className="messaging-search"><Search size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…" aria-label="Rechercher une conversation" /></div>
          <nav className="messaging-specials" aria-label="Canaux spéciaux">
            {canUseSupport && !me?.isPlatformAdmin && <ChannelButton active={active?.kind === 'support'} icon={<ShieldCheck size={18} />} title="GymFlow Support" subtitle={supportThreads[0]?.unread ? `${supportThreads[0].unread} message(s) non lu(s)` : 'Conversation privée avec la plateforme'} onClick={() => setActive({ kind: 'support' })} />}
            <ChannelButton active={active?.kind === 'announcements'} icon={<Bell size={18} />} title="Annonces GymFlow" subtitle={`${announcements.filter(a => !a.isRead).length} non lue(s)`} onClick={() => setActive({ kind: 'announcements' })} />
          </nav>

          {me?.isPlatformAdmin ? (
            <div className="conversation-section">
              <div className="conversation-section-label">Demandes support</div>
              {supportThreads.length === 0 ? <EmptyMini text="Aucune conversation support." /> : supportThreads.map(thread => (
                <ChannelButton key={thread.id} active={active?.kind === 'support' && active.id === thread.orgId}
                  icon={<ShieldCheck size={18} />} title={thread.orgName} subtitle={thread.lastBody ?? 'Nouvelle conversation'}
                  onClick={() => setActive({ kind: 'support', id: thread.orgId })} />
              ))}
            </div>
          ) : clubMessaging ? (
            <div className="conversation-section">
              <div className="conversation-section-label">Conversations</div>
              {loading ? <ConversationSkeleton /> : filtered.length === 0 ? <EmptyMini text={search ? 'Aucun résultat.' : 'Aucune conversation. Commencez un échange.'} /> : filtered.map(conversation => (
                <button key={conversation.id} className={`conversation-row${active?.id === conversation.id ? ' active' : ''}`} onClick={() => setActive({ kind: 'conversation', id: conversation.id })}>
                  <Avatar name={conversation.name} team={conversation.type === 'team'} />
                  <span className="conversation-copy"><span className="conversation-name">{conversation.name}</span><span className="conversation-preview">{conversation.last_body ?? (conversation.type === 'team' ? 'Canal interne du club' : 'Aucun message')}</span></span>
                  <span className="conversation-meta"><time>{shortTime(conversation.last_at ?? conversation.updated_at)}</time>{conversation.unread > 0 && <b aria-label={`${conversation.unread} messages non lus`}>{conversation.unread > 99 ? '99+' : conversation.unread}</b>}</span>
                </button>
              ))}
            </div>
          ) : <EmptyMini text="Les conversations privées sont réservées à l’équipe du club." />}
        </aside>

        <main className="messaging-conversation">
          {!active ? <MessagingWelcome platform={Boolean(me?.isPlatformAdmin)} /> : active.kind === 'announcements' ? (
            <AnnouncementsPanel announcements={announcements} platform={platformMessaging} detailsOpen={detailsOpen} onToggleDetails={() => setDetailsOpen(value => !value)} onReload={async () => { if (me) await loadNavigation(me) }} />
          ) : (
            <>
              <div className="conversation-header">
                <button className="mobile-chat-back" onClick={() => setActive(null)} aria-label="Retour"><ArrowLeft size={19} /></button>
                {!sidebarOpen && <button className="icon-btn desktop-sidebar-open" onClick={() => setSidebarOpen(true)} aria-label="Afficher les conversations" title="Afficher les conversations"><PanelLeftOpen size={19} /></button>}
                <Avatar name={active.kind === 'support' ? 'GymFlow Support' : selectedConversation?.name ?? 'Conversation'} team={selectedConversation?.type === 'team'} />
                <div><h2>{active.kind === 'support' ? (me?.isPlatformAdmin ? supportThreads.find(t => t.orgId === active.id)?.orgName ?? 'Support' : 'GymFlow Support') : selectedConversation?.name}</h2><p>{active.kind === 'support' ? 'Canal privé et audité' : info?.type === 'team' ? 'Espace interne du club' : `${info?.members.length ?? 0} participant(s)`}</p></div>
                {active.kind === 'conversation' && info?.type === 'group' && <button className="icon-btn" onClick={() => setShowInfo(true)} aria-label="Informations du groupe"><Info size={18} /></button>}
                <button className="icon-btn details-toggle" onClick={() => setDetailsOpen(value => !value)} aria-label={detailsOpen ? 'Fermer le panneau Activité' : 'Ouvrir le panneau Activité'} title={detailsOpen ? 'Fermer le panneau Activité' : 'Ouvrir le panneau Activité'}>{detailsOpen ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}</button>
              </div>

              <div className="message-scroll" aria-live="polite">
                {active.kind === 'conversation' && hasOlder && !loadingChat && <button className="load-older" onClick={() => void loadOlder()}><ChevronDown size={14} /> Charger les messages précédents</button>}
                {!loadingChat && <div className="conversation-date-marker"><span>Aujourd’hui</span></div>}
                {loadingChat ? <div className="chat-loading"><LoaderCircle className="spin" /> Chargement…</div> : (active.kind === 'conversation' ? messages.length === 0 : supportMessages.length === 0) ? (
                  <div className="chat-empty"><MessageCircle size={34} /><h3>Commencez la conversation</h3><p>Écrivez un premier message. Il restera privé aux participants autorisés.</p></div>
                ) : active.kind === 'conversation' ? messages.map(message => (
                  <MessageBubble key={message.id} conversationId={active.id!} message={message} own={message.authorId === me?.user.id} onReply={() => setReply(message)} onReact={emoji => void react(message.id, emoji)} />
                )) : supportMessages.map(message => (
                  <SupportBubble key={message.id} message={message} own={message.authorId === me?.user.id} />
                ))}
                <div ref={bottomRef} />
              </div>

              <div className="composer-wrap">
                {reply && <div className="reply-preview"><Reply size={15} /><span><b>{reply.authorName}</b>{reply.body}</span><button onClick={() => setReply(null)} aria-label="Annuler la réponse"><X size={15} /></button></div>}
                {mentionCandidates.length > 0 && <div className="mention-menu" role="listbox" aria-label="Suggestions de mentions">{mentionCandidates.slice(0, 8).map(person => (
                  <button key={person.id} role="option" onClick={() => {
                    setComposer(value => value.replace(/@[\p{L}\p{N} '-]*$/u, `@${person.name} `)); setMentionIds(ids => [...new Set([...ids, person.id])])
                  }}><Avatar name={person.name} small /><span>{person.name}<small>{roleLabel(person.role)}</small></span></button>
                ))}</div>}
                <div className="message-composer">
                  <textarea value={composer} maxLength={4000} rows={1} placeholder="Écrire un message…" aria-label="Message"
                    onChange={e => setComposer(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }} />
                  <span className="composer-count">{composer.length}/4000</span>
                  {active.kind === 'conversation' && <><input ref={fileInputRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv,application/zip,.docx,.xlsx" onChange={e => { const file = e.target.files?.[0]; if (file) void attach(file) }} /><button className="composer-tool" onClick={() => fileInputRef.current?.click()} disabled={uploading} aria-label="Envoyer un fichier">{uploading ? <LoaderCircle className="spin" size={16} /> : <Paperclip size={16} />}</button></>}
                  <button className="send-btn" onClick={() => void send()} disabled={!composer.trim() || sending} aria-label="Envoyer">{sending ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}</button>
                </div>
              </div>
            </>
          )}
        </main>

        {detailsOpen && (active?.kind === 'announcements' ? <AnnouncementDetails announcements={announcements} onClose={() => setDetailsOpen(false)} /> : active && (
          <ConversationDetails
            title={active.kind === 'support' ? (me?.isPlatformAdmin ? supportThreads.find(t => t.orgId === active.id)?.orgName ?? 'Support' : 'GymFlow Support') : selectedConversation?.name ?? 'Conversation'}
            description={active.kind === 'support' ? 'Échange confidentiel avec GymFlow' : selectedConversation?.description}
            type={active.kind === 'support' ? 'support' : info?.type ?? selectedConversation?.type}
            members={active.kind === 'conversation'
              ? info?.type === 'team'
                ? [{ id: me!.user.id, name: me!.user.name, role: me!.org?.role ?? null, isAdmin: 0 }, ...people.map(person => ({ ...person, isAdmin: 0 }))]
                : info?.members ?? []
              : []}
            messages={active.kind === 'conversation' ? messages : []}
            conversationId={active.kind === 'conversation' ? active.id! : undefined}
            onManage={info?.type === 'group' ? () => setShowInfo(true) : undefined}
            onClose={() => setDetailsOpen(false)}
          />
        ))}

        {showInfo && info?.type === 'group' && active?.id && <GroupPanel info={info} me={me!} people={people} onClose={() => setShowInfo(false)} onChanged={async () => { await loadConversation(active.id!, true); if (me) await loadNavigation(me) }} />}
      </section>
      {newDialog && me && <NewConversationDialog kind={newDialog} people={people} onClose={() => setNewDialog(null)} onCreated={async id => { setNewDialog(null); await loadNavigation(me); setActive({ kind: 'conversation', id }) }} />}
    </div>
  )
}

function ChannelButton({ active, icon, title, subtitle, onClick }: { active: boolean; icon: React.ReactNode; title: string; subtitle: string; onClick: () => void }) {
  return <button className={`special-channel${active ? ' active' : ''}`} onClick={onClick}><span className="special-icon">{icon}</span><span><b>{title}</b><small>{subtitle}</small></span></button>
}

function Avatar({ name, team, small }: { name: string; team?: boolean; small?: boolean }) {
  return <span className={`message-avatar${small ? ' small' : ''}${team ? ' team' : ''}`} aria-hidden="true">{team ? <Hash size={small ? 14 : 18} /> : initials(name)}</span>
}

function MessageBubble({ conversationId, message, own, onReply, onReact }: { conversationId: string; message: Message; own: boolean; onReply: () => void; onReact: (emoji: string) => void }) {
  const [reactions, setReactions] = useState(false)
  return <article className={`message-line${own ? ' own' : ''}`}>
    <Avatar name={message.authorName} small />
    <div className="message-stack">
      <span className="message-author">{own ? 'Moi' : message.authorName}<time>{shortTime(message.createdAt)}</time></span>
      <div className="message-bubble">
        {message.replyToId && <div className="quoted-message"><b>{message.replyAuthor}</b><span>{message.replyBody}</span></div>}
        {(!message.attachments || message.attachments.length === 0) && <p>{message.body}</p>}
        {message.attachments?.map(attachment => <AttachmentView key={attachment.id} conversationId={conversationId} attachment={attachment} />)}
        <time>{shortTime(message.createdAt)}{own && <Check size={12} />}</time>
        <div className="message-actions"><button onClick={onReply} aria-label="Répondre"><Reply size={14} /></button><button onClick={() => setReactions(!reactions)} aria-label="Réagir"><SmilePlus size={14} /></button></div>
        {reactions && <div className="reaction-picker">{EMOJIS.map(emoji => <button key={emoji} onClick={() => { onReact(emoji); setReactions(false) }}>{emoji}</button>)}</div>}
      </div>
      {message.reactions.length > 0 && <div className="reaction-row">{message.reactions.map(reaction => <button key={reaction.emoji} className={reaction.reacted ? 'mine' : ''} onClick={() => onReact(reaction.emoji)}>{reaction.emoji} {reaction.count}</button>)}</div>}
    </div>
  </article>
}

function AttachmentView({ conversationId, attachment }: { conversationId: string; attachment: Attachment }) {
  const href = attachmentUrl(conversationId, attachment.id)
  return attachment.kind === 'image'
    ? <a className="message-image" href={href} target="_blank" rel="noreferrer"><img src={href} alt={attachment.fileName} /><span>{attachment.fileName}</span></a>
    : <a className="message-file" href={href} download><FileText size={18} /><span><b>{attachment.fileName}</b><small>{formatBytes(attachment.sizeBytes)}</small></span></a>
}

function SupportBubble({ message, own }: { message: SupportMessage; own: boolean }) {
  const author = message.authorKind === 'support' ? 'GymFlow Support' : message.authorName
  return <article className={`message-line${own ? ' own' : ''}`}><Avatar name={author} small /><div className="message-stack"><span className="message-author">{own ? 'Moi' : author}<time>{shortTime(message.createdAt)}</time></span><div className={`message-bubble${message.authorKind === 'support' ? ' support' : ''}`}><p>{message.body}</p></div></div></article>
}

function ConversationDetails({ title, description, type, members, messages, conversationId, onManage, onClose }: {
  title: string; description?: string | null; type?: string; members: Member[]; messages: Message[]
  conversationId?: string; onManage?: () => void; onClose: () => void
}) {
  const [section, setSection] = useState<'media' | 'files' | 'links' | null>('media')
  const label = type === 'support' ? 'Support officiel' : type === 'team' ? 'Canal du club' : type === 'group' ? 'Groupe privé' : 'Message direct'
  const attachments = messages.flatMap(message => message.attachments ?? [])
  const images = attachments.filter(attachment => attachment.kind === 'image')
  const files = attachments.filter(attachment => attachment.kind === 'file')
  const links = [...new Set(messages.flatMap(message => message.body.match(/https?:\/\/[^\s<]+/gi) ?? []))]
  return <aside className="conversation-details" aria-label="Informations de la conversation">
    <header className="activity-heading"><b>Activité</b><span><ShieldCheck size={18} /><button className="details-close" onClick={onClose} aria-label="Fermer le panneau Activité" title="Fermer"><X size={18} /></button></span></header>
    <section className="activity-stories"><span>Participants</span>{members.length > 0 ? <div>{members.slice(0, 5).map(member => <div key={member.id}><Avatar name={member.name} small /><small>{member.name.split(' ')[0]}</small></div>)}</div> : <p>Aucun participant à afficher</p>}</section>
    <div className="details-profile"><span className="details-section-title">Profil</span><Avatar name={title} team={type === 'team'} /><h3>{title}</h3><span>{label}</span>{description && <p>{description}</p>}</div>
    <section className="details-media"><button onClick={() => setSection(section === 'media' ? null : 'media')}><span>Médias ({images.length})</span><ChevronDown className={section === 'media' ? 'open' : ''} size={16} /></button>{section === 'media' && <div className="media-grid">{images.length && conversationId ? images.map(image => <a key={image.id} href={attachmentUrl(conversationId, image.id)} target="_blank" rel="noreferrer"><img src={attachmentUrl(conversationId, image.id)} alt={image.fileName} /></a>) : <span>Aucun média partagé</span>}</div>}</section>
    <section className="details-files"><span>Ressources</span><button onClick={() => setSection(section === 'files' ? null : 'files')}><FileText size={15} /> Documents ({files.length}) <ChevronDown size={15} /></button>{section === 'files' && <div className="resource-list">{files.length && conversationId ? files.map(file => <a key={file.id} href={attachmentUrl(conversationId, file.id)} download><FileText size={14} /><span>{file.fileName}</span></a>) : <small>Aucun document partagé</small>}</div>}<button onClick={() => setSection(section === 'links' ? null : 'links')}><Link2 size={15} /> Liens ({links.length}) <ChevronDown size={15} /></button>{section === 'links' && <div className="resource-list">{links.length ? links.map(link => <a key={link} href={link} target="_blank" rel="noopener noreferrer"><Link2 size={14} /><span>{link}</span></a>) : <small>Aucun lien partagé</small>}</div>}{onManage && <button onClick={onManage}><Users size={15} /> Gérer le groupe <ChevronDown size={15} /></button>}</section>
  </aside>
}

function NewConversationDialog({ kind, people, onClose, onCreated }: { kind: 'dm' | 'group'; people: Person[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [selected, setSelected] = useState<string[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const visible = people.filter(person => person.name.toLowerCase().includes(query.toLowerCase()))
  async function create() {
    if ((kind === 'dm' && selected.length !== 1) || (kind === 'group' && (!name.trim() || selected.length === 0))) return
    setBusy(true)
    try {
      const data = kind === 'dm'
        ? await api.post<{ id: string }>('/api/messaging/dm', { userId: selected[0] })
        : await api.post<{ id: string }>('/api/messaging/groups', { name, description, memberIds: selected })
      onCreated(data.id)
    } catch (e) { setError(messageOf(e)); setBusy(false) }
  }
  return <div className="messaging-modal-backdrop" onMouseDown={onClose}><div className="messaging-modal" role="dialog" aria-modal="true" aria-labelledby="new-chat-title" onMouseDown={e => e.stopPropagation()}>
    <div className="modal-title"><div><p className="eyebrow">Messagerie</p><h2 id="new-chat-title">{kind === 'dm' ? 'Nouveau message' : 'Créer un groupe'}</h2></div><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
    {kind === 'group' && <><label>Nom du groupe<input value={name} maxLength={100} onChange={e => setName(e.target.value)} placeholder="Ex. Équipe événement" /></label><label>Description <span>(facultatif)</span><textarea value={description} maxLength={500} onChange={e => setDescription(e.target.value)} /></label></>}
    <div className="messaging-search"><Search size={16} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher dans votre club" /></div>
    <div className="people-picker">{visible.map(person => { const checked = selected.includes(person.id); return <button key={person.id} onClick={() => setSelected(current => kind === 'dm' ? [person.id] : checked ? current.filter(id => id !== person.id) : [...current, person.id])}><Avatar name={person.name} small /><span><b>{person.name}</b><small>{roleLabel(person.role)}</small></span><i className={checked ? 'checked' : ''}>{checked && <Check size={13} />}</i></button> })}</div>
    {error && <p className="form-error">{error}</p>}
    <div className="modal-actions"><button className="btn-ghost" onClick={onClose}>Annuler</button><button className="btn-dark" onClick={() => void create()} disabled={busy}>{busy ? 'Création…' : kind === 'dm' ? 'Ouvrir' : 'Créer le groupe'}</button></div>
  </div></div>
}

function GroupPanel({ info, me, people, onClose, onChanged }: { info: GroupInfo; me: Me; people: Person[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const self = info.members.find(member => member.id === me.user.id)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(info.name ?? '')
  const available = people.filter(person => !info.members.some(member => member.id === person.id))
  async function action(path: string, method: 'post' | 'patch' | 'del', body?: unknown) { await api[method](path, body); await onChanged() }
  return <aside className="group-panel"><div className="group-panel-header"><h3>Informations du groupe</h3><button className="icon-btn" onClick={onClose}><X size={17} /></button></div><div className="group-identity"><Avatar name={info.name ?? 'Groupe'} team />{editing ? <form onSubmit={e => { e.preventDefault(); void action(`/api/messaging/conversations/${info.id}`, 'patch', { name }).then(() => setEditing(false)) }}><input value={name} maxLength={100} onChange={e => setName(e.target.value)} /><button type="submit">Enregistrer</button></form> : <><h4>{info.name}</h4>{self?.isAdmin && <button className="rename-group" onClick={() => setEditing(true)}>Renommer</button>}</>}<p>{info.members.length} participant(s)</p></div>
    <div className="group-members-title"><span>Membres</span>{self?.isAdmin ? <button onClick={() => setAdding(!adding)}><Plus size={14} /> Ajouter</button> : null}</div>
    {adding && <div className="group-add-list">{available.length === 0 ? <span>Toute l’équipe est déjà présente.</span> : available.map(person => <button key={person.id} onClick={() => void action(`/api/messaging/groups/${info.id}/members`, 'post', { memberIds: [person.id] })}><Plus size={13} /> {person.name}</button>)}</div>}
    <div className="group-member-list">{info.members.map(member => <div key={member.id}><Avatar name={member.name} small /><span><b>{member.name}</b><small>{member.isAdmin ? 'Admin du groupe' : roleLabel(member.role ?? '')}</small></span>{self?.isAdmin && member.id !== me.user.id && <details><summary aria-label="Actions"><MoreHorizontal size={17} /></summary><div>{member.isAdmin ? <button onClick={() => void action(`/api/messaging/groups/${info.id}/admins/${member.id}`, 'del')}>Retirer admin</button> : <button onClick={() => void action(`/api/messaging/groups/${info.id}/admins/${member.id}`, 'post')}>Nommer admin</button>}<button className="danger" onClick={() => void action(`/api/messaging/groups/${info.id}/members/${member.id}`, 'del')}>Retirer</button></div></details>}</div>)}</div>
    <button className="leave-group" onClick={() => void action(`/api/messaging/groups/${info.id}/leave`, 'post')}>Quitter le groupe</button>
    {self?.isAdmin && <button className="archive-group" onClick={() => { if (confirm('Archiver ce groupe ? Son historique sera conservé.')) void api.del(`/api/messaging/conversations/${info.id}`).then(onChanged).then(onClose) }}>Archiver le groupe</button>}
  </aside>
}

function AnnouncementsPanel({ announcements, platform, detailsOpen, onToggleDetails, onReload }: { announcements: Announcement[]; platform: boolean; detailsOpen: boolean; onToggleDetails: () => void; onReload: () => Promise<void> }) {
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  async function publish() { await api.post('/api/messaging/announcements', { title, content, status: 'published' }); setTitle(''); setContent(''); setCreating(false); await onReload() }
  async function markRead(item: Announcement) { if (item.isRead || item.status !== 'published') return; await api.post(`/api/messaging/announcements/${item.id}/read`); await onReload() }
  async function react(item: Announcement, emoji: string) { if (platform || item.status !== 'published') return; await api.post(`/api/messaging/announcements/${encodeURIComponent(item.id)}/reactions`, { emoji }); await onReload() }
  const unread = announcements.filter(item => !item.isRead && item.status === 'published').length
  return <><div className="conversation-header announcement-chat-header"><span className="message-avatar"><Bell size={18} /></span><div><h2>Annonces GymFlow</h2><p>Canal officiel de la plateforme · lecture seule</p></div>{unread > 0 && <span className="announcement-chat-unread">{unread} non lue{unread > 1 ? 's' : ''}</span>}{platform && <button className="btn-dark announcement-publish" onClick={() => setCreating(!creating)}><Plus size={15} /> Publier</button>}<button className="icon-btn details-toggle" onClick={onToggleDetails} aria-label={detailsOpen ? 'Fermer le panneau Informations' : 'Ouvrir le panneau Informations'} title={detailsOpen ? 'Fermer le panneau Informations' : 'Ouvrir le panneau Informations'}>{detailsOpen ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}</button></div>
    <div className="message-scroll announcements-thread" aria-live="polite">
      {creating && <div className="announcement-editor"><input value={title} maxLength={160} onChange={e => setTitle(e.target.value)} placeholder="Titre de l’annonce" /><textarea value={content} maxLength={8000} onChange={e => setContent(e.target.value)} placeholder="Votre message…" /><div><button className="btn-ghost" onClick={() => setCreating(false)}>Annuler</button><button className="btn-dark" disabled={!title.trim() || !content.trim()} onClick={() => void publish()}>Publier maintenant</button></div></div>}
      {announcements.length === 0 ? <div className="chat-empty"><Bell size={32} /><h3>Aucune annonce</h3><p>Les nouvelles de GymFlow apparaîtront ici.</p></div> : [...announcements].reverse().map(item => <AnnouncementMessage key={item.id} item={item} platform={platform} onRead={() => void markRead(item)} onReact={emoji => void react(item, emoji)} />)}
    </div>
    <div className="announcement-readonly"><ShieldCheck size={16} /><span><b>Canal officiel GymFlow</b>Seule la plateforme peut publier dans cette conversation.</span></div>
  </>
}

function AnnouncementMessage({ item, platform, onRead, onReact }: { item: Announcement; platform: boolean; onRead: () => void; onReact: (emoji: string) => void }) {
  const [reactions, setReactions] = useState(false)
  const canReact = !platform && item.status === 'published'
  const announcementReactions = item.reactions ?? []
  return <article className={`message-line announcement-line${item.isRead ? '' : ' unread'}`} onClick={onRead}>
    <span className="message-avatar"><Bell size={16} /></span>
    <div className="message-stack">
      <span className="message-author">GymFlow <time>{longDate(item.publishedAt ?? item.createdAt)}</time></span>
      <div className="message-bubble announcement-bubble">
        <h3>{item.title}</h3>
        <p>{item.content}</p>
        <footer>{item.publisherName ?? 'GymFlow'} · {item.status === 'published' ? 'Annonce officielle' : item.status}</footer>
        {canReact && <div className="message-actions announcement-actions">
          <button onClick={event => { event.stopPropagation(); setReactions(value => !value) }} aria-label="Réagir à l’annonce"><SmilePlus size={14} /></button>
        </div>}
        {reactions && <div className="reaction-picker announcement-reaction-picker" onClick={event => event.stopPropagation()}>
          {EMOJIS.map(emoji => <button key={emoji} onClick={() => { onReact(emoji); setReactions(false) }}>{emoji}</button>)}
        </div>}
        {!item.isRead && <span className="announcement-new">Nouveau</span>}
      </div>
      {announcementReactions.length > 0 && <div className="reaction-row announcement-reactions" onClick={event => event.stopPropagation()}>
        {announcementReactions.map(reaction => canReact
          ? <button key={reaction.emoji} className={reaction.reacted ? 'mine' : ''} onClick={() => onReact(reaction.emoji)}>{reaction.emoji} {reaction.count}</button>
          : <span key={reaction.emoji}>{reaction.emoji} {reaction.count}</span>)}
      </div>}
    </div>
  </article>
}

function AnnouncementDetails({ announcements, onClose }: { announcements: Announcement[]; onClose: () => void }) {
  const published = announcements.filter(item => item.status === 'published')
  return <aside className="conversation-details announcement-details"><header className="activity-heading"><b>Informations</b><span><ShieldCheck size={18} /><button className="details-close" onClick={onClose} aria-label="Fermer le panneau Informations" title="Fermer"><X size={18} /></button></span></header><div className="details-profile"><span className="details-section-title">Canal officiel</span><span className="message-avatar"><Bell size={22} /></span><h3>GymFlow</h3><span>Communication plateforme</span><p>Les informations importantes envoyées à tous les clubs GymFlow.</p></div><div className="announcement-stats"><div><b>{published.length}</b><span>annonces publiées</span></div><div><b>{published.filter(item => !item.isRead).length}</b><span>non lues</span></div></div><div className="details-note announcement-note"><ShieldCheck size={16} /><p>Ce canal est authentifié et géré exclusivement par les Superadmins de la plateforme.</p></div></aside>
}

function MessagingWelcome({ platform }: { platform: boolean }) { return <div className="messaging-welcome"><div className="welcome-mark"><MessageCircle size={34} /></div><h2>Vos échanges, au même endroit</h2><p>{platform ? 'Choisissez une demande support ou consultez les annonces.' : 'Sélectionnez une conversation, retrouvez votre équipe ou contactez GymFlow Support.'}</p><div><span><ShieldCheck size={15} /> Accès contrôlé</span><span><Users size={15} /> Isolé par club</span></div></div> }
function ConversationSkeleton() { return <div className="conversation-skeleton">{[1, 2, 3, 4].map(i => <div key={i}><i /><span><b /><small /></span></div>)}</div> }
function EmptyMini({ text }: { text: string }) { return <p className="conversation-empty">{text}</p> }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'GF' }
function roleLabel(role: string) { return ({ owner: 'Propriétaire', admin: 'Administrateur', staff: 'Équipe', viewer: 'Lecture' } as Record<string, string>)[role] ?? role }
function messageOf(error: unknown) { return error instanceof ApiError ? error.message : 'Une erreur est survenue.' }
function shortTime(value: string | null) { if (!value) return ''; const date = new Date(value); return date.toLocaleTimeString('fr-MA', { hour: '2-digit', minute: '2-digit' }) }
function longDate(value: string) { return new Date(value).toLocaleDateString('fr-MA', { day: 'numeric', month: 'long', year: 'numeric' }) }
function attachmentUrl(conversationId: string, attachmentId: string) { return `/api/messaging/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachmentId)}` }
function formatBytes(bytes: number) { return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} Ko` : `${(bytes / 1024 / 1024).toFixed(1)} Mo` }
