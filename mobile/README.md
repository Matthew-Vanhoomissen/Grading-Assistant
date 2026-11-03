# Grader Capture (mobile)

A phone app that photographs handwritten submissions and uploads them
straight to a question on the grader server. It is **capture-only**: creating
assignments, questions, and tests, reviewing transcriptions, and grading all
happen on the desktop.

- Expo **SDK 58** (React Native 0.88), JavaScript, run in **Expo Go**
- Packages: `expo-image-picker` (system camera), `expo-image-manipulator`
  (resize + JPEG), `expo-secure-store` (saved URL and token),
  `expo-file-system` (deletes photos after upload),
  `react-native-safe-area-context` (keeps content clear of the notch)

## Setup

1. Install **Expo Go** on the phone from the App Store or Play Store. It must
   support SDK 58, which the current store version does.
2. On the laptop:

   ```
   cd mobile
   npm install
   ```

3. Start the backend in network mode (see "Phone access" in the root
   `README.md`): set `API_TOKEN` and `API_HOST=0.0.0.0` in `.env`, then
   `python -m backend.app`. Find the laptop's IPv4 address with `ipconfig`.

## Run

```
cd mobile
npx expo start
```

Scan the QR code with the iPhone Camera app or with Expo Go on Android. The
phone and laptop must be on the **same Wi-Fi**.

There are two separate connections, and one working doesn't mean the other does:

| Connection | Used for | If it fails |
|---|---|---|
| Phone → Metro (port 8081) | loading the app | `npx expo start --tunnel` (Metro only) |
| Phone → Flask (port 5000) | API calls and uploads | firewall, IP, `API_HOST`; a tunnel doesn't help |

## Using it

1. **Connect:** enter `http://<laptop-ip>:5000` and the token, then tap
   **Test connection**. The values are saved on the phone even if the test
   fails. On success, tap **Continue**.
   - "Server rejected the token": you reached the server, but the token is wrong.
   - "Can't reach …" or "No response": wrong IP, server not in network mode,
     firewall, or a different Wi-Fi.
2. **Assignments**, then **Questions**: pull down or tap Refresh to reload.
3. **Capture:** Take photo, then Retake or Use photo, type the student label,
   and tap Submit. After a successful upload the label clears and you stay on
   the same question for the next paper.
4. **Recent uploads** (under the capture controls): each label with its status.
   It refreshes every 3 s while anything is `queued` or `processing`, and
   shows `error_message` for errors.

### Rapid fire (one student at a time)

The steps above go question by question, photographing the whole class for
one question at a time. To do one student's whole paper instead, tap
**Rapid fire (by student)** on the Questions screen.

1. Type the student label and tap **Start**. If that label already has photos
   on any question of this assignment, the app lists those questions. You can
   then tap **Change label** or **Continue anyway**.
2. The camera opens for question 1. The preview shows the student and
   "1 of N: question title". **Use photo** uploads it and opens the camera for
   the next question. **Retake** shoots again, and **Skip question** moves on
   without uploading (for a blank answer).
3. If an upload fails, you stay on that question with **Retry upload**. Nothing
   moves on until it succeeds or you skip.
4. After the last question, a summary shows Uploaded, Skipped, or Failed for
   each one. Tap **Next student** to start over with an empty label.

Back leaves rapid fire at any point. Photos already uploaded stay uploaded.

Android's back button steps back one screen.

## Config

`src/config.js` holds the default server URL (empty by default, so the
Connect screen starts blank), the resize settings (long edge 2000 px, JPEG
quality 0.8), the poll interval, and the timeouts. The token is never stored
in source. It is typed into the app and saved in SecureStore.

## Image handling

- Photos come from the system camera at full quality. Each one is resized so
  its long edge is at most 2000 px and saved as a JPEG at quality 0.8. That
  re-encode also converts iPhone HEIC to JPEG.
- The upload sends the JPEG as `files` and the typed label as `labels`, using
  multipart `FormData`. The app doesn't set Content-Type itself.
- Expo replaces the global `fetch`, and its `FormData` rejects React Native's
  `{ uri, name, type }` file objects ("Unsupported FormDataPart
  implementation"). The app appends an `expo-file-system` `File` instead. The
  upload's filename is the cache file's name (`<uuid>.jpg`), and the server
  stores it under its own name anyway.
- Photos stay in the app's cache only. The camera original is deleted right
  after conversion, and the JPEG after a successful upload, or on Retake or
  when you leave the screen. Nothing is saved to the camera roll.

## Known limitations

- **Plain HTTP.** The token travels unencrypted, so use only trusted networks.
  Expo Go allows cleartext HTTP to LAN addresses. A standalone build would
  need explicit cleartext configuration, which isn't set up.
- Uploads show a spinner, not a percentage, because `fetch` doesn't report
  progress.
- If an upload times out (60 s), it may still have reached the server. The
  error says to check Recent uploads before retrying, to avoid duplicates.
- No offline queue. If the server is unreachable, the photo stays on screen
  so you can tap Submit again.
- Mistaken uploads can only be deleted from the desktop.

## Not built (out of scope)

Viewing transcriptions or results, grading, editing or deleting anything,
offline queueing, notifications, accounts, app store builds, and chat.
