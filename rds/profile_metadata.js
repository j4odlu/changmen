/** [changmen 扩展] Public login/presence persistence port; no raw pool access. */
export { hasProfileMetadataStorage, recordUserLoginMetadata, persistUserPresence } from "./rds/profile_store.js";
