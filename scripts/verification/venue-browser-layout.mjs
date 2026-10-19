// [changmen 扩展] Physical browser sources still belong to the existing private adapter workspace.
export const VENUE_BROWSER_SOURCE_ROOT = 'client/packages/venue-browser';
export const VENUE_BROWSER_OWNER = 'packages/venue-adapter';
export function ownsRelocatedVenueBrowser(file) {
  return file === VENUE_BROWSER_SOURCE_ROOT || file.startsWith(VENUE_BROWSER_SOURCE_ROOT + '/');
}
