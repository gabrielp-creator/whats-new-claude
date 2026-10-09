# Security

Please report security problems privately through GitHub: on this repository's **Security** tab,
choose **Report a vulnerability**. Do not open a public issue for them.

What the plugin does with your data, and its safety design, are described in [README.md](README.md)
and [PRIVACY.md](PRIVACY.md). Release text it fetches is treated as untrusted data throughout: only
Claude calls with no tools, in safe mode, ever judge it.
