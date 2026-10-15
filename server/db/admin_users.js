// Public persistence port for managed login users; authorization stays in backend.
export {
  createManagedUser,
  readManagedUserIdentity,
  hasManagedUserName,
  deleteManagedUser,
  resetManagedUserPassword,
  countManagedAdministrators,
  countManagedTeamMembers,
} from "./rds/admin_users_store.js";
