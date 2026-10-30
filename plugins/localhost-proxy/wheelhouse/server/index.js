/**
 * Localhost proxy, bundled with Wheelhouse in the installed-plugin format.
 * It adds nothing to the pages and reads nothing: the plugin is the switch
 * and the settings for Wheelhouse's own localhost proxy
 * (src/lib/server/localproxy/), which answers only while this plugin is on.
 * While it is on, Wheelhouse shows each http address on its own computer
 * (127.0.0.1 or localhost) through itself, at `<port>.localhost` on the port
 * the viewer reached Wheelhouse on, and passes those requests on to that port
 * on its loopback. Its settings say which ports it opens: those the crew has
 * reported (`reported`, on by default) and those listed (`ports`).
 *
 * @typedef {import('@chrisjowen/wheelhouse-plugin-sdk').WheelhousePlugin} WheelhousePlugin
 */

/** @type {WheelhousePlugin} */
export default { providers: [], contributions: [] };
