# Screen Safari Studio

I want ui design for my tv app just like Netflix apple tv and Google tv i want design for channel player movies and series player and home ui with tab also a written file so I can drop in my ai and tell him to make exactly same

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://screen-safari-studio.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/c9af0b17-3006-4afa-ae4e-096bd41681bd).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Where the maxTV credentials go

maxTV is a **Stalker portal**: no username, no password. A subscription is four values that
identify the device, and all four must belong to the same account:

| Value | Environment variable | Meaning |
| --- | --- | --- |
| portal | `MAXTV_PORTAL` | panel address, e.g. `http://new.maxtv.be/stalker_portal/c/` |
| mac | `MAXTV_MAC` | the device the panel bills, `00:1A:79:XX:XX:XX` |
| serial | `MAXTV_SERIAL` | box serial |
| device id | `MAXTV_DEVICE_ID` | the long hex id that goes with the serial |

**Edit them in [`src/lib/maxtv-account.ts`](src/lib/maxtv-account.ts).** That file is the one place
they live, it needs no settings screen, and a change there deploys like any other change. Each value
can also be overridden by the matching environment variable above — the environment wins, one value
at a time, and `/api/live/diagnose?source=maxtv` reports `configured.fromEnv` so there is never a
question about which one answered.

Then press Refresh on the maxTV tab. If it still lists nothing, that URL is the next thing to read:
it shows the identity in use, every portal address tried, and what the panel said to each.

**A MAC in a public repository is a MAC anyone can use**, and a portal that sees two devices on one
MAC will refuse both. If the account is not already public, set the environment variables instead of
writing the values into the file.

## Which playlist the AK TV tab reads

`TGTV_PLAYLIST_URL` overrides it; the default is a working public M3U. `/api/live/diagnose?playlist=1`
reports the address in use, the status, content type, first line and channel count of the read.
