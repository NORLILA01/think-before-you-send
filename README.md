# Think Before You Send

A small tool that checks a draft message for aggression and suggests a calmer way to say it.

- **Check:** a classifier runs in your browser (`docs/`, loads `detector.js` + `model.json`). Nothing is sent anywhere.
- **Coaching (opt-in per message):** if you click the button, that one message goes through a Cloudflare Worker (`worker/`) to a third-party language model via OpenRouter. The API key stays in the Worker. Nothing is stored by this project.
- **Self-harm wording** is not coached; the page shows a support message instead.

## Measured limits
Trained on [Civil Comments](https://huggingface.co/datasets/google/civil_comments) (CC0), news-site comments rather than private chat. On 97,320 held-out comments: ROC-AUC 0.903; at the default threshold precision 0.60, recall 0.53. It misses about half of aggressive messages and can flag harmless ones. No bias audit has been done. See `detector/README.md`.

## Not a clinical or crisis tool
This is a communication aid. If you may hurt yourself, contact local emergency services or a crisis line (findahelpline.com).

## Layout
| Folder | Contents |
|---|---|
| `docs/` | The static site (served by GitHub Pages) |
| `worker/` | Cloudflare Worker proxy + tests (`node --test worker.test.mjs`) |
| `detector/` | Training script, exported model, JS port, parity test |
