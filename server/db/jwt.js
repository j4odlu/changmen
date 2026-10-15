// Public access to the existing signer; no change to claims, TTL parsing or key policy.
export { signJwt, JWT_ACCESS_TTL_SEC } from "./rds/jwt.js";
