// ---------------------------------------------------------------------------
// galleryUploadOutcome — what to SAY after a drop on the Photos card.
//
// Three things can come off one drag, and they are not the same event:
//
//   photo      taken as a photo, on this record, where it was dropped
//   video      evidence of the same work, filed under Documents because the
//              photos pipeline is an image pipeline — an implementation fact,
//              not the assessor's problem, so it is never called a misfile
//   document   a PDF floor plan, a DWG, a spreadsheet: a document that landed
//              on the wrong card. Filed anyway (documentation is never
//              blocked), and SAID, because silently filing it elsewhere looks
//              exactly like an upload that vanished
//
// The wording rules were three nested branches inside the upload handler and
// grew a fourth the moment video stopped being lumped in with the drawings.
// They are here instead so they can be read, and tested, without a browser.
//
// Pure — no React, no Supabase. See scripts/gallery-upload-outcome-fixture.mjs.
// ---------------------------------------------------------------------------

const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many)

// "is a AutoCAD" was in the shipped string. The format names are read aloud in
// the head, and the vowel-letter rule gets every kind the palette produces
// right — an AutoCAD, an Excel, an Archive, an XML, a PDF, a Word.
const article = word => (/^[AEIOU]/i.test(String(word || '')) ? 'an' : 'a')

/**
 * The success messages for one drop, in the order they should be shown.
 *
 * @param {object} o
 * @param {number} o.attempted   files the person dropped
 * @param {number} o.photos      landed as photos
 * @param {string[]} o.photoNames  their file names, for the single-photo case
 * @param {Array}  o.videos      [{name}] landed as video documents
 * @param {Array}  o.documents   [{name, kind}] landed as documents (misfiled)
 * @returns {string[]} zero or more messages; empty when nothing succeeded
 */
export function uploadOutcomeMessages({ attempted = 0, photos = 0, photoNames = [], videos = [], documents = [] } = {}) {
  const vid = videos.length
  const doc = documents.length
  const total = photos + vid + doc
  if (total === 0) return []

  const out = []

  // Photos, when they are not the whole story. When they ARE the whole story
  // the file name is the friendlier confirmation, so that case is last.
  if (photos > 0 && (vid || doc)) {
    out.push(`Uploaded ${photos} ${plural(photos, 'photo')}`)
  }

  // A video is named as a video and told where it lives. No apology: the
  // person filed evidence and it is filed.
  if (vid === 1) {
    out.push(`${videos[0].name} is a video — saved to this record under Documents`)
  } else if (vid > 1) {
    out.push(`${vid} videos — saved to this record under Documents`)
  }

  // A document says what it actually is ("AutoCAD", "PDF"), because that is
  // the fact that explains why it is not in the photo grid.
  if (doc === 1) {
    out.push(`${documents[0].name} is ${article(documents[0].kind)} ${documents[0].kind}, not a photo — filed under Documents`)
  } else if (doc > 1) {
    out.push(`${doc} files were documents, not photos — filed under Documents`)
  }

  // Nothing but photos: one file confirms by NAME, which is what the person
  // was looking at when they dropped it; a batch confirms by count.
  if (photos > 0 && !vid && !doc) {
    out.push(attempted === 1 && photoNames[0]
      ? `Uploaded ${photoNames[0]}`
      : `Uploaded ${photos} of ${attempted} files`)
  }

  return out
}
