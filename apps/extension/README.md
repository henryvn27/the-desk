# The Desk Browser Bridge

The build output in `dist-extension/` is a Manifest V3 extension for Chrome
and Edge. Load that directory as an unpacked extension during development, or
use the same directory from the packaged app's `dist-extension/` archive.

The extension captures only after the student presses **Capture active tab**.
It sends the current HTTP(S) URL, title, selected text, and bounded visible
text. Site hints are advisory; generic capture remains the fallback.

In Desk Settings → Browser bridge, copy the loopback endpoint and pairing token
into the extension. The desktop host accepts only the versioned page-context
envelope over loopback and never receives provider credentials. If the host is
unavailable or the browser denies page access, the extension reports a bounded
error and keeps the reviewed capture local to the popup.
