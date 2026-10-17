# WhatsApp phone-number pairing

The user requests the existing WhatsApp “Link with phone number instead” alternative. Add a visible phone action alongside QR and inside the pairing dialog. Enter an international number, request Baileys' pairing code only after its connecting/QR event, and display the code with phone instructions. Retain QR and current credentials; a registered account must be explicitly unlinked before replacing it.

The entered number is a pairing target only. Sender identity comes from a confirmed connected socket and existing scope binding. Code requests never import/activate contacts or start automation. Pairing codes stay in private authenticated transport state and are cleared on disconnect, connection loss and success; they are not written into CRM activity or relationship backups. Baileys' private auth credentials remain in the existing auth store.

Reject invalid numbers, duplicate requests and linked-account replacement. Handle readiness/request timeouts, errors and stale completions after cancellation. Test the actual transport with an injected socket, the authenticated HTTP route, and native keyboard/mouse controls. Do not request a live pairing code for an arbitrary number during development.
