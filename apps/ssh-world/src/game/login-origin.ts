/** Every fresh SSH login begins at the world's canonical arrival point.
 *
 * Worker hot reloads are deliberately not fresh logins: their restored session
 * state remains in place so a deploy cannot teleport connected players.
 */
export const LOGIN_ORIGIN = Object.freeze({ x: 0, y: 0 });
