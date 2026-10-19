// [changmen 扩展] Browser sources have their own private workspace and package declarations.
export const VENUE_BROWSER_SOURCE_ROOT = 'client/packages/venue-browser';
export const VENUE_BROWSER_OWNER = VENUE_BROWSER_SOURCE_ROOT;
export function ownsRelocatedVenueBrowser(file) {
  return file === VENUE_BROWSER_SOURCE_ROOT || file.startsWith(VENUE_BROWSER_SOURCE_ROOT + '/');
}
