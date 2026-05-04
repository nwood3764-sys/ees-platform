import { useState, useEffect } from 'react'
import { C } from '../data/constants'
import { LoadingState, ErrorState } from '../components/UI'
import {
  loadSchedule, saveSchedule, fetchReports,
  dispatchScheduleNow, fetchScheduleRunHistory,
} from '../data/reportsService'
import { supabase } from '../lib/supabase'

// ─── Schedule Editor ──────────────────────────────────────────────────────
//
// Two-tab UI: Settings (the schedule definition) and History (run audit
// log from scheduled_report_runs). New schedules show only Settings until
// they've been saved.

const FREQUENCIES = [
  { value: 'daily',   label: 'Daily' },
  { value: 'weekly',  label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

const ISO_DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
]

const TIMEZONES = [
  'America/Chicago',     // WI, Madison HQ
  'America/New_York',    // NC ops
  'America/Denver',      // CO ops
  'America/Detroit',     // MI ops
  'America/Indiana/Indianapolis',  // IN ops
  'UTC',
]

const FORMATS = [
  { value: 'csv',  label: 'CSV — comma-separated values' },
  { value: 'xlsx', label: 'XLSX — Excel workbook' },
  // PDF deferred to v3 of the dispatcher — needs page-layout work
]

export default function ScheduleEditor({ scheduleId, onClose, onSaved }) {
  const isNew = !scheduleId || scheduleId === 'new'
  const [tab, setTab]           = useState('settings')
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [reports, setReports]   = useState([])

  const [schedule, setSchedule] = useState({
    sr_report_id:          '',
    sr_name:               '',
    sr_frequency:          'daily',
    sr_day_of_week:        1,
    sr_day_of_month:       1,
    sr_send_time:          '09:00',
    sr_timezone:           'America/Chicago',
    sr_format:             'csv',
    sr_subject_line:       '',
    sr_message_body:       '',
    sr_recipient_user_ids: [],
    sr_recipient_role_ids: [],
    sr_recipient_emails:   [],
    sr_is_active:          true,
  })

  const [emailsInput, setEmailsInput] = useState('')
  const [users, setUsers]             = useState([])
  const [roles, setRoles]             = useState([])
  const [history, setHistory]         = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function init() {
      setLoading(true); setError(null)
      try {
        const [reportsData, usersRes, rolesRes] = await Promise.all([
          fetchReports(),
          supabase.from('users').select('id, user_name, user_email').eq('is_deleted', false).order('user_name'),
          supabase.from('roles').select('id, role_name').eq('is_deleted', false).order('role_name'),
        ])
        if (cancelled) return
        setReports(reportsData)
        setUsers(usersRes.data || [])
        setRoles(rolesRes.data || [])

        if (!isNew) {
          const loaded = await loadSchedule(scheduleId)
          if (cancelled) return
          if (!loaded) { setError(new Error('Schedule not found.')); setLoading(false); return }
          setSchedule({
            sr_report_id:          loaded.sr_report_id,
            sr_name:               loaded.sr_name || '',
            sr_frequency:          loaded.sr_frequency || 'daily',
            sr_day_of_week:        loaded.sr_day_of_week ?? 1,
            sr_day_of_month:       loaded.sr_day_of_month ?? 1,
            sr_send_time:          (loaded.sr_send_time || '09:00:00').slice(0, 5),
            sr_timezone:           loaded.sr_timezone || 'America/Chicago',
            sr_format:             loaded.sr_format || 'csv',
            sr_subject_line:       loaded.sr_subject_line || '',
            sr_message_body:       loaded.sr_message_body || '',
            sr_recipient_user_ids: loaded.sr_recipient_user_ids || [],
            sr_recipient_role_ids: loaded.sr_recipient_role_ids || [],
            sr_recipient_emails:   loaded.sr_recipient_emails || [],
            sr_is_active:          loaded.sr_is_active !== false,
          })
          setEmailsInput((loaded.sr_recipient_emails || []).join(', '))
        }
        setLoading(false)
      } catch (err) {
        if (!cancelled) { setError(err); setLoading(false) }
      }
    }
    init()
    return () => { cancelled = true }
  }, [scheduleId, isNew])

  // Load history when the History tab is opened
  useEffect(() => {
    if (tab !== 'history' || isNew) return
    setHistoryLoading(true)
    fetchScheduleRunHistory(scheduleId)
      .then(setHistory)
      .catch(err => console.warn('history load failed:', err))
      .finally(() => setHistoryLoading(false))
  }, [tab, scheduleId, isNew])

  const updateSchedule = (patch) => setSchedule(prev => ({ ...prev, ...patch }))

  const handleSave = async () => {
    if (!schedule.sr_name)       { alert('Schedule name is required.'); return }
    if (!schedule.sr_report_id)  { alert('Pick a report.'); return }
    if (!schedule.sr_subject_line) { alert('Subject line is required.'); return }
    setSaving(true); setError(null)
    try {
      // Convert emails text input to array
      const emails = emailsInput.split(',').map(s => s.trim()).filter(Boolean)
      const newId = await saveSchedule({
        id: scheduleId,
        schedule: { ...schedule, sr_recipient_emails: emails },
      })
      setSavedAt(new Date())
      onSaved?.(newId)
    } catch (err) {
      setError(err)
    } finally {
      setSaving(false)
    }
  }

  const handleTestSend = async () => {
    if (isNew) { alert('Save the schedule before testing.'); return }
    setTesting(true); setTestResult(null)
    try {
      const result = await dispatchScheduleNow(scheduleId, { dryRunForce: true })
      setTestResult(result)
    } catch (err) {
      setTestResult({ error: err.message })
    } finally {
      setTesting(false)
    }
  }

  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} />

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:C.page }}>
      {/* Header */}
      <div style={{
        background:C.card, borderBottom:`1px solid ${C.border}`,
        padding:'14px 24px', display:'flex', alignItems:'center', justifyContent:'space-between',
      }}>
        <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
          <div style={{ fontSize:11, color:C.textMuted }}>{isNew ? 'New Scheduled Report' : 'Edit Scheduled Report'}</div>
          <div style={{ fontSize:18, fontWeight:600, color:C.textPrimary }}>
            {schedule.sr_name || 'Untitled Schedule'}
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {savedAt && (
            <div style={{ fontSize:11, color:C.textMuted }}>Saved {savedAt.toLocaleTimeString()}</div>
          )}
          {!isNew && (
            <button onClick={handleTestSend} disabled={testing} style={btnSecondary(testing)}>
              {testing ? 'Testing…' : 'Test (dry run)'}
            </button>
          )}
          <button onClick={onClose} style={btnSecondary()}>Close</button>
          <button onClick={handleSave} disabled={saving} style={btnPrimary(saving)}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Test result toast */}
      {testResult && (
        <div style={{
          background: testResult.error
            ? '#fee'
            : (testResult.runs?.[0]?.warnings?.length || testResult.runs?.[0]?.status === 'success_with_warnings')
              ? '#fff4e0'
              : '#e8f5ec',
          border: `1px solid ${
            testResult.error
              ? '#f99'
              : (testResult.runs?.[0]?.warnings?.length || testResult.runs?.[0]?.status === 'success_with_warnings')
                ? '#f5c469'
                : '#9c9'
          }`,
          padding: '8px 24px', fontSize: 12, color: C.textPrimary,
        }}>
          {testResult.error ? (
            <span>Test failed: {testResult.error}</span>
          ) : testResult.runs?.[0] ? (
            <span>
              Test {testResult.runs[0].status}: {testResult.runs[0].row_count ?? 0} rows,
              {' '}{testResult.runs[0].recipient_count ?? 0} recipients
              {testResult.runs[0].error ? ` — error: ${testResult.runs[0].error}` : ''}
              {testResult.runs[0].warnings?.length ? (
                <div style={{ marginTop: 4, fontSize: 11, color: '#92400e' }}>
                  {testResult.runs[0].warnings.map((w, i) => <div key={i}>• {w}</div>)}
                </div>
              ) : null}
            </span>
          ) : (
            <span>Test result: {JSON.stringify(testResult)}</span>
          )}
          <button onClick={() => setTestResult(null)} style={{
            float:'right', background:'transparent', border:'none', cursor:'pointer',
            color:C.textMuted, fontSize:12, padding:0,
          }}>Dismiss</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{
        background:C.card, borderBottom:`1px solid ${C.border}`,
        display:'flex', padding:'0 24px',
      }}>
        {['settings'].concat(isNew ? [] : ['history']).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding:'12px 16px', background:'transparent', border:'none',
              borderBottom: tab === t ? `2px solid ${C.emerald}` : '2px solid transparent',
              fontSize:13, fontWeight: tab === t ? 600 : 500,
              color: tab === t ? C.textPrimary : C.textSecondary,
              cursor:'pointer', textTransform:'capitalize',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div style={{ flex:1, overflow:'auto', padding:'20px 24px' }}>
        {tab === 'settings' ? (
          <SettingsTab
            schedule={schedule} updateSchedule={updateSchedule}
            reports={reports} users={users} roles={roles}
            emailsInput={emailsInput} setEmailsInput={setEmailsInput}
          />
        ) : (
          <HistoryTab history={history} loading={historyLoading} />
        )}
      </div>
    </div>
  )
}

// ─── Settings tab ─────────────────────────────────────────────────────────

function SettingsTab({ schedule, updateSchedule, reports, users, roles, emailsInput, setEmailsInput }) {
  return (
    <div style={{ display:'grid', gap:16 }}>
      <div style={card()}>
        <div style={cardHeader()}>Report</div>
        <div style={{ padding:14, display:'grid', gap:14 }}>
          <div>
            <label style={fieldLabel()}>Report</label>
            <select value={schedule.sr_report_id || ''}
              onChange={e => updateSchedule({ sr_report_id: e.target.value })}
              style={inputStyle()}>
              <option value="">— Select —</option>
              {reports.map(r => (
                <option key={r._id} value={r._id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={fieldLabel()}>Schedule Name</label>
            <input type="text" value={schedule.sr_name}
              onChange={e => updateSchedule({ sr_name: e.target.value })}
              placeholder="e.g. Weekly Project Status"
              style={inputStyle()} />
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <input type="checkbox" id="active" checked={schedule.sr_is_active}
              onChange={e => updateSchedule({ sr_is_active: e.target.checked })} />
            <label htmlFor="active" style={{ fontSize:12, color:C.textSecondary, cursor:'pointer' }}>
              Active — paused schedules don't fire
            </label>
          </div>
        </div>
      </div>

      <div style={card()}>
        <div style={cardHeader()}>When</div>
        <div style={{ padding:14, display:'grid', gap:14 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
            <div>
              <label style={fieldLabel()}>Frequency</label>
              <select value={schedule.sr_frequency}
                onChange={e => updateSchedule({ sr_frequency: e.target.value })}
                style={inputStyle()}>
                {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label style={fieldLabel()}>Send Time (local)</label>
              <input type="time" value={schedule.sr_send_time}
                onChange={e => updateSchedule({ sr_send_time: e.target.value })}
                style={inputStyle()} />
            </div>
            <div>
              <label style={fieldLabel()}>Timezone</label>
              <select value={schedule.sr_timezone}
                onChange={e => updateSchedule({ sr_timezone: e.target.value })}
                style={inputStyle()}>
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
          </div>
          {schedule.sr_frequency === 'weekly' && (
            <div>
              <label style={fieldLabel()}>Day of Week</label>
              <select value={schedule.sr_day_of_week}
                onChange={e => updateSchedule({ sr_day_of_week: parseInt(e.target.value, 10) })}
                style={inputStyle()}>
                {ISO_DAYS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          )}
          {schedule.sr_frequency === 'monthly' && (
            <div>
              <label style={fieldLabel()}>Day of Month</label>
              <input type="number" min={1} max={31}
                value={schedule.sr_day_of_month}
                onChange={e => updateSchedule({ sr_day_of_month: parseInt(e.target.value, 10) || 1 })}
                style={inputStyle()} />
              <div style={{ fontSize:11, color:C.textMuted, marginTop:4 }}>
                If the month has fewer days (e.g. day 31 in February), the schedule fires on the last day of the month.
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={card()}>
        <div style={cardHeader()}>Recipients</div>
        <div style={{ padding:14, display:'grid', gap:14 }}>
          <div>
            <label style={fieldLabel()}>Specific Users</label>
            <MultiSelect
              options={users.map(u => ({ value: u.id, label: `${u.user_name} <${u.user_email || 'no email'}>` }))}
              value={schedule.sr_recipient_user_ids}
              onChange={vs => updateSchedule({ sr_recipient_user_ids: vs })}
              placeholder="None — select to add users"
            />
          </div>
          <div>
            <label style={fieldLabel()}>By Role</label>
            <MultiSelect
              options={roles.map(r => ({ value: r.id, label: r.role_name }))}
              value={schedule.sr_recipient_role_ids}
              onChange={vs => updateSchedule({ sr_recipient_role_ids: vs })}
              placeholder="None — select to add roles (every user with the role gets a copy)"
            />
          </div>
          <div>
            <label style={fieldLabel()}>Additional Email Addresses</label>
            <input type="text" value={emailsInput}
              onChange={e => setEmailsInput(e.target.value)}
              placeholder="comma,separated@addresses.com"
              style={inputStyle()} />
            <div style={{ fontSize:11, color:C.textMuted, marginTop:4 }}>
              External recipients who don't have a user account in the system.
            </div>
          </div>
        </div>
      </div>

      <div style={card()}>
        <div style={cardHeader()}>Email</div>
        <div style={{ padding:14, display:'grid', gap:14 }}>
          <div>
            <label style={fieldLabel()}>Subject Line</label>
            <input type="text" value={schedule.sr_subject_line}
              onChange={e => updateSchedule({ sr_subject_line: e.target.value })}
              placeholder="e.g. Weekly Project Status — {{date}}"
              style={inputStyle()} />
          </div>
          <div>
            <label style={fieldLabel()}>Message Body (optional)</label>
            <textarea value={schedule.sr_message_body}
              onChange={e => updateSchedule({ sr_message_body: e.target.value })}
              rows={4}
              placeholder="Message included above the report summary in the email body."
              style={inputStyle()} />
          </div>
          <div>
            <label style={fieldLabel()}>Format</label>
            <select value={schedule.sr_format}
              onChange={e => updateSchedule({ sr_format: e.target.value })}
              style={inputStyle()}>
              {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── History tab ──────────────────────────────────────────────────────────

function HistoryTab({ history, loading }) {
  if (loading) {
    return <div style={{ padding:24, textAlign:'center', color:C.textMuted }}>Loading…</div>
  }
  if (history.length === 0) {
    return (
      <div style={card()}>
        <div style={cardHeader()}>History</div>
        <div style={{ padding:24, textAlign:'center', color:C.textMuted, fontSize:13 }}>
          No runs yet. The dispatcher will pick this up at the next scheduled time
          (or you can use the Test button up top to fire it manually).
        </div>
      </div>
    )
  }
  return (
    <div style={card()}>
      <div style={cardHeader()}>History ({history.length} most recent)</div>
      <div style={{ overflow:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead style={{ background:C.cardSecondary }}>
            <tr>
              <th style={th()}>Started</th>
              <th style={th()}>Status</th>
              <th style={th()}>Rows</th>
              <th style={th()}>Recipients</th>
              <th style={th()}>Provider</th>
              <th style={th()}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {history.map(r => {
              // Notes column collapses error_message and warnings into a single
              // user-facing column. Errors win when both are present (shouldn't
              // happen, but defensive). Warnings join with ' / ' and use amber.
              const notes = r.srr_error_message
                ? { text: r.srr_error_message, color: '#c33' }
                : (r.srr_warnings?.length
                    ? { text: r.srr_warnings.join(' / '), color: '#92400e' }
                    : { text: '—', color: C.textMuted })
              return (
                <tr key={r.id} style={{ borderTop:`1px solid ${C.border}` }}>
                  <td style={td()}>{new Date(r.srr_started_at).toLocaleString()}</td>
                  <td style={td()}><StatusBadge status={r.srr_status} /></td>
                  <td style={td()}>{r.srr_row_count ?? '—'}</td>
                  <td style={td()}>{r.srr_recipient_count ?? '—'}</td>
                  <td style={td()}>{r.srr_email_provider || '—'}</td>
                  <td style={{ ...td(), color: notes.color, maxWidth:280, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                      title={notes.text}>
                    {notes.text}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatusBadge({ status }) {
  const colors = {
    success:               { bg:'#e8f5ec', fg:'#2a8048' },
    success_with_warnings: { bg:'#fff4e0', fg:'#92400e' },
    success_dry_run:       { bg:'#fff7e6', fg:'#a26500' },
    no_recipients:         { bg:'#f0f3f8', fg:'#4a5e7a' },
    no_rows:               { bg:'#f0f3f8', fg:'#4a5e7a' },
    report_error:          { bg:'#fee', fg:'#c33' },
    send_error:            { bg:'#fee', fg:'#c33' },
    running:               { bg:'#e8f0ff', fg:'#2a5fa6' },
  }
  const { bg, fg } = colors[status] || { bg:C.cardSecondary, fg:C.textSecondary }
  return (
    <span style={{
      display:'inline-block', padding:'2px 8px', borderRadius:4,
      background:bg, color:fg, fontSize:11, fontWeight:500,
    }}>{status}</span>
  )
}

// ─── Tiny multi-select using checkboxes ──────────────────────────────────
// The codebase doesn't have a generic MultiSelect; rather than ship a
// proper combobox component just for this editor, use a checkbox list.

function MultiSelect({ options, value, onChange, placeholder }) {
  const [open, setOpen] = useState(false)
  const selected = options.filter(o => value.includes(o.value))
  return (
    <div style={{ position:'relative' }}>
      <button onClick={() => setOpen(!open)} style={{
        ...inputStyle(), textAlign:'left', cursor:'pointer',
        color: selected.length === 0 ? C.textMuted : C.textPrimary,
      }}>
        {selected.length === 0
          ? placeholder
          : selected.map(s => s.label).join(', ').slice(0, 80) + (selected.length > 3 ? `… (+${selected.length - 3})` : '')}
      </button>
      {open && (
        <div style={{
          position:'absolute', top:'100%', left:0, right:0, zIndex:10,
          background:C.card, border:`1px solid ${C.borderDark}`, borderRadius:6,
          maxHeight:240, overflow:'auto', marginTop:4,
          boxShadow:'0 4px 12px rgba(0,0,0,0.08)',
        }}>
          {options.length === 0 ? (
            <div style={{ padding:12, fontSize:12, color:C.textMuted }}>No options.</div>
          ) : options.map(o => (
            <label key={o.value} style={{
              display:'flex', alignItems:'center', gap:8,
              padding:'6px 10px', cursor:'pointer', fontSize:12,
            }}
            onMouseEnter={e => e.currentTarget.style.background = C.cardSecondary}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <input type="checkbox"
                checked={value.includes(o.value)}
                onChange={() => {
                  if (value.includes(o.value)) onChange(value.filter(v => v !== o.value))
                  else onChange([...value, o.value])
                }} />
              <span>{o.label}</span>
            </label>
          ))}
          <div style={{
            padding:'4px 10px', fontSize:11, color:C.textMuted,
            borderTop:`1px solid ${C.border}`, textAlign:'right',
          }}>
            <button onClick={() => setOpen(false)} style={{
              background:'transparent', border:'none', cursor:'pointer',
              color:C.emerald, fontSize:11, padding:0,
            }}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Style helpers ────────────────────────────────────────────────────────

function card()       { return { background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'visible' } }
function cardHeader() { return {
  padding:'10px 12px', fontSize:13, fontWeight:600, color:C.textPrimary,
  borderBottom:`1px solid ${C.border}`, background:C.cardSecondary,
} }
function fieldLabel() { return {
  display:'block', fontSize:11, fontWeight:500, color:C.textSecondary,
  marginBottom:4, textTransform:'uppercase', letterSpacing:0.5,
} }
function inputStyle() { return {
  width:'100%', padding:'8px 10px', fontSize:13,
  background:C.card, color:C.textPrimary,
  border:`1px solid ${C.border}`, borderRadius:6, font:'inherit',
  boxSizing:'border-box',
} }
function btnPrimary(disabled) { return {
  padding:'8px 14px', fontSize:13, fontWeight:500,
  background: disabled ? C.borderDark : C.emerald, color:'#fff',
  border:'none', borderRadius:6, cursor: disabled ? 'default' : 'pointer',
} }
function btnSecondary(disabled) { return {
  padding:'8px 14px', fontSize:13, fontWeight:500,
  background:C.card, color:C.textPrimary,
  border:`1px solid ${C.borderDark}`, borderRadius:6,
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.6 : 1,
} }
function th() { return {
  padding:'8px 12px', fontSize:10, fontWeight:600, color:C.textSecondary,
  textTransform:'uppercase', letterSpacing:0.5, textAlign:'left',
} }
function td() { return {
  padding:'8px 12px', fontSize:12, color:C.textPrimary,
} }
