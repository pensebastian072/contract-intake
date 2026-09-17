# Contract Intake for Windows

[![Download Contract Intake for Windows](https://img.shields.io/badge/Download_for_Windows-Contract_Intake-166534?style=for-the-badge&logo=windows)](https://github.com/pensebastian072/contract-intake/releases/latest/download/Contract-Intake-Windows.zip)

Click the green button above, extract the downloaded ZIP, then double-click `INSTALL-CONTRACT-INTAKE.cmd`. It installs the required Windows component if needed, creates the desktop icon, starts the private local service, and opens the app.

## Install on another computer

1. Click **Download for Windows** above.
2. Extract the entire ZIP into a permanent folder, for example Documents\Contract Intake. Do not run it from inside the ZIP.
3. Double-click `INSTALL-CONTRACT-INTAKE.cmd` once.

On first launch, an internet connection is needed to install Node.js when absent and download application components. Windows may show a normal installer prompt. A setup window shows progress and any errors. Once ready, the app opens at http://127.0.0.1:4317 in your default browser. Later launches use the **Contract Intake** desktop icon and reuse the running service. The service runs in the background until you sign out or restart Windows. Moving the app folder requires recreating the shortcut (remove the old shortcut first).

This is a local browser app with a desktop shortcut, not a standalone EXE. It runs separately on each computer; localhost is never a shareable address. Transaction documents are selected separately on each computer and are not included in this download.

## Put the clean copy on GitHub

Use only the contents of the generated `dist/Contract-Intake` folder, NOT the original working project folder. The clean copy excludes transaction documents, real-packet fixtures, private test outputs, logs, caches and installed dependencies.

1. Create a GitHub repository under your account. A private repository limits access to invited users.
2. Upload the files and folders INSIDE `dist/Contract-Intake`, preserving their structure. Include `.gitignore` as well. Alternatively, publish that clean folder with GitHub Desktop.
3. On the other computer, sign into GitHub if the repository is private, choose Code > Download ZIP, extract it, and follow the installation steps above.

Do not enable GitHub Pages: this app needs a local Node.js service, not static web hosting. A private repository is still not a place to upload transaction documents. Rebuild the clean package when sharing later changes.

## Privacy and limitations

The running app uses local document processing and offline OCR. It does not send email or upload documents to external services. Uploads and extracted text are held in memory; cache entries expire after 30 minutes and restarting the service clears them. Node.js dependency downloads happen only during installation or a dependency update.

Review extracted facts before use. V1 supports the tested Florida AS IS form and explicit labeled fields; other layouts require additional testing. It does not provide legal advice.

## Developer checks

Run `npm ci`, `npm test`, and `npm run check` from this folder. Shared tests use fictional examples and do not include the owner's private transaction-packet regression.
