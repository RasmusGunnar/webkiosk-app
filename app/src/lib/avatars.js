import {t} from '../i18n/index.js'
export const AVATAR_BUCKET = 'household-avatars'
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
export function validateAvatar(file) {
  if (!extensions[file.type]) throw new Error((t("avatars.choose_a_png_jpeg_or_webp_image")))
  if (file.size <= 0 || file.size > AVATAR_MAX_BYTES) throw new Error((t("avatars.the_avatar_must_be_no_larger_than_2_mb")))
}
export function avatarDisplayUrl(person) {
  const value = person.avatar_display_url || person.avatar_url || ''
  return /^(https?:\/\/|data:image\/(?:png|jpeg|webp|gif);base64,)/i.test(value) ? value : ''
}
export async function resolveAvatarUrls(client, people) {
  const withPaths = people.filter(person => person.avatar_path)
  if (!withPaths.length) return people
  const { data, error } = await client.storage.from(AVATAR_BUCKET).createSignedUrls(withPaths.map(person => person.avatar_path), 3600)
  if (error) return people // Existing DataURLs/URLs remain usable.
  const urls = new Map((data || []).map(item => [item.path, item.signedUrl]))
  return people.map(person => ({ ...person, avatar_display_url: urls.get(person.avatar_path) || '' }))
}
export async function savePerson(client, householdId, values, { existing, file } = {}) {
  const id = existing?.id || crypto.randomUUID()
  let newPath = null
  try {
    const payload = { ...values, avatar_url: existing?.avatar_url || values.avatar_url || null }
    if (file) {
      validateAvatar(file)
      newPath = householdId + '/' + id + '/' + crypto.randomUUID() + '.' + extensions[file.type]
      const upload = await client.storage.from(AVATAR_BUCKET).upload(newPath, file, { contentType: file.type, upsert: false })
      if (upload.error) throw upload.error
      payload.avatar_path = newPath
      payload.avatar_url = null
    }
    const result = existing
      ? await client.from('household_people').update(payload).eq('id', id).eq('household_id', householdId)
      : await client.from('household_people').insert({ id, household_id: householdId, ...payload })
    if (result.error) throw result.error
    if (file && existing?.avatar_path && existing.avatar_path.startsWith(householdId + '/' + id + '/')) {
      // A failed cleanup must not turn a successful person save into a retry/duplicate.
      await client.storage.from(AVATAR_BUCKET).remove([existing.avatar_path]).catch(() => {})
    }
    return { id, error: null }
  } catch (error) {
    if (newPath) await client.storage.from(AVATAR_BUCKET).remove([newPath]).catch(() => {})
    return { id, error }
  }
}
