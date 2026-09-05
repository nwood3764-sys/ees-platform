// =============================================================================
// task-create-fixture — a person can create a task, and the vocabulary is not
// written down in the client.
//
// Why this exists: tasks shipped with fetch/complete/reopen and NO insert path,
// and nobody noticed for months because the object, the module and the list all
// looked finished. 71 tasks accumulated, every one written by a database
// trigger, and Nicholas eventually asked why he could not find the feature at
// all. A missing create path is invisible from the outside — nothing errors,
// there is simply no button — so it needs a guard that fails the build.
//
// Source-text checks, deliberately: importing the service pulls in the Supabase
// client and a live session. What must not regress is structural.
// =============================================================================

import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const check = (name, ok) => {
  if (ok) { pass++; console.log(`PASS  ${name}`) }
  else    { fail++; console.log(`FAIL  ${name}`) }
}

const service = readFileSync(new URL('../src/data/tasksService.js', import.meta.url), 'utf8')
const module_ = readFileSync(new URL('../src/modules/TasksModule.jsx', import.meta.url), 'utf8')
const modal   = readFileSync(new URL('../src/components/NewTaskModal.jsx', import.meta.url), 'utf8')
const fieldMd = readFileSync(new URL('../src/data/fieldMetadataService.js', import.meta.url), 'utf8')

// ── The create path exists at all ──────────────────────────────────────────
check('tasksService exports createTask', /export\s+async\s+function\s+createTask\b/.test(service))
check('createTask inserts into tasks',   /\.from\(['"]tasks['"]\)[\s\S]{0,200}\.insert\(/.test(service))
check('tasksService exports fetchAssignableUsers', /export\s+async\s+function\s+fetchAssignableUsers\b/.test(service))
check('tasksService exports fetchTaskPicklists',   /export\s+async\s+function\s+fetchTaskPicklists\b/.test(service))

// ── A task is always assigned to somebody ──────────────────────────────────
// LEAP's rule is that every record has a NAMED owner assigned at creation.
// Defaulting the owner to the creator would quietly assign work to whoever
// opened the form, which is the failure this refuses.
check('createTask refuses a task with no owner', /needs somebody assigned/i.test(service))
check('createTask refuses an empty subject',     /needs a subject/i.test(service))
check('createTask stamps created_by_id',         /created_by_id:/.test(service))
check('the modal disables save until owner and subject are set',
  /canSave\s*=\s*subject\.trim\(\)\s*!==\s*''\s*&&\s*ownerId\s*!==\s*''/.test(modal))

// ── Record numbering follows the platform convention ───────────────────────
// tasks numbered its records `task_number` while every other record-carrying
// table uses `<prefix>_record_number`. That is what excluded tasks from
// conversation_related_to_objects(), which tests for a %_record_number column,
// so a task could not carry Communications. The old spelling must not return.
check('the service reads task_record_number',       /task_record_number/.test(service))
check('the service no longer reads task_number',    !/\btask_number\b/.test(service))
check('createTask leaves the record number to the trigger',
  /task_record_number:\s*''/.test(service))

// ── The vocabulary lives in the database, not in the client ────────────────
// It used to be hardcoded here AND disagree with the column default and with
// every writer, so a task could carry a status no filter in the UI matched.
check('the module does not hardcode the status list',
  !/options:\s*\[\s*['"]Open['"]/.test(module_))
check('the module builds its columns from the loaded vocabulary',
  /buildCols\(statusOptions\)/.test(module_))
check('the module loads the vocabulary from the service',
  /fetchTaskPicklists/.test(module_))
check('the modal does not hardcode a default status string',
  !/useState\(['"]Open['"]\)/.test(modal))

// ── The New Task affordance is actually rendered ───────────────────────────
check('the module renders a New Task control', /New Task<\/button>/.test(module_))
check('the module mounts NewTaskModal',        /<NewTaskModal/.test(module_))
check('creating a task refreshes the list',    /onCreated=\{[\s\S]{0,200}load\(\)/.test(module_))

// ── A task resolves to a readable name ─────────────────────────────────────
// fieldMetadataService mapped tasks to a `task_name` column that has never
// existed, so every lookup picker and breadcrumb resolving a task rendered
// blank. The name of a task is its subject.
check('tasks resolve their display name to subject', /tasks:\s*['"]subject['"]/.test(fieldMd))
check('no task_name column is referenced anywhere', !/['"]task_name['"]/.test(fieldMd))

console.log(`task-create-fixture: ${pass} checks passed${fail ? `, ${fail} FAILED` : ''}`)
if (fail) process.exit(1)
