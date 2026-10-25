// Stable identity prevents network authentication and incidental auth rerenders.
const auth = { ready: true, user: { id: "browser-regression-user" } };

export function useAuth() {
  return auth;
}
