# Contributing to FuelScope

Thank you for your interest in improving FuelScope!

## Reporting issues

Issues are tracked on the [GitHub Issues page](../../issues).

### Before you open an issue

1. Search existing issues to avoid duplicates.
2. Make sure you can reproduce the problem on the latest version of the app.

### Creating an issue

1. Open the [Issues tab](../../issues) and click **New issue**.
2. Choose the appropriate template:
   - **Bug report** – for anything that is broken or behaving unexpectedly.
   - **Feature request** – for new ideas or improvements.
3. Fill in every section of the template as completely as possible.
4. Click **Submit new issue**.

### Good issue checklist

- [ ] Title is short and descriptive.
- [ ] Steps to reproduce are listed (for bugs).
- [ ] Expected and actual behaviour are both described (for bugs).
- [ ] Browser, OS and URL are included (for bugs).
- [ ] Screenshots or console output are attached where helpful.

## Contributing code

1. Fork the repository and create a branch from `main`.
2. Make your changes following the existing code style (Vanilla JS, no build step).
3. Test locally with `python3 -m http.server 8080` before pushing.
4. Enable the pre-commit hook to avoid committing accidental secrets:
   ```bash
   ./scripts/setup-git-hooks.sh
   ```
5. Open a pull request against `main` with a clear description of what changed and why.
