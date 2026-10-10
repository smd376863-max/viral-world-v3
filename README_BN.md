# Viral World V3 — Telegram Auto Feed + Mini App

এই প্রজেক্টে আছে:
- Telegram channel-এর নতুন পোস্ট webhook দিয়ে backend-এ সেভ করা
- Mini App / ওয়েব UI-তে ৩০ সেকেন্ড পরপর ফিড refresh
- Telegram photo thumbnail server-side proxy দিয়ে দেখানো (Bot Token browser-এ প্রকাশ হয় না)
- Telegram `initData` signature validation-সহ `/api/me` ও protected admin route
- JSON file storage (ছোট ডেমো/কম ট্রাফিকের জন্য)

## আগে যা লাগবে
1. Node.js 20+ সহ hosting (Render/Railway/Fly.io/VPS—যে hosting persistent disk দেয়)।
2. HTTPS public URL; Telegram Mini App production-এ HTTPS চায়।
3. Telegram bot token (@BotFather থেকে)।
4. Public channel username বা private channel ID।
5. Bot-কে channel-এ administrator বানাতে হবে, যাতে `channel_post` update আসে।

## 1. Bot তৈরি
- Telegram-এ `@BotFather` খুলুন, `/newbot` পাঠান এবং নির্দেশনা অনুসরণ করুন।
- Bot token গোপন রাখুন। Token কারও সঙ্গে শেয়ার করবেন না, HTML-এ রাখবেন না।
- Channel-এ bot-কে administrator করুন। পোস্ট দেখার জন্য সাধারণত `Post Messages` permission যথেষ্ট।
- Public channel হলে `TELEGRAM_CHANNEL_ID`-এ channel ID দিন (যেমন `@mychannel` নয়, নির্ভরযোগ্য numeric ID যেমন `-100...`) এবং `TELEGRAM_CHANNEL_USERNAME`-এ username দিন।
- Channel ID জানা না থাকলে bot admin করার পর একটি নতুন channel post দিন, server log বা সাময়িক webhook update inspect করে `chat.id` বের করুন। Token-সহ URL কাউকে পাঠাবেন না।

## 2. সার্ভার চালানো
টার্মিনালে:
```bash
npm install
cp .env.example .env
```
`.env` ফাইল খুলে values বসান:
- `PUBLIC_BASE_URL`: আপনার live HTTPS URL, শেষে slash না দিলেও চলবে।
- `TELEGRAM_BOT_TOKEN`: BotFather token।
- `TELEGRAM_BOT_USERNAME`: @ ছাড়া bot username।
- `TELEGRAM_CHANNEL_ID`: channel numeric ID, যেমন `-1001234567890`।
- `TELEGRAM_CHANNEL_USERNAME`: public channel হলে @ ছাড়া username; private হলে ফাঁকা রাখুন।
- `TELEGRAM_WEBHOOK_SECRET`: কমপক্ষে 32 অক্ষরের random secret (অক্ষর/সংখ্যা/underscore/hyphen)।
- `ADMIN_TELEGRAM_USER_ID`: আপনার Telegram numeric user ID; admin route ব্যবহার না করলে ফাঁকা রাখা যায়।

তারপর:
```bash
npm start
```
Local health check: `http://localhost:3000/api/health`

## 3. Webhook সেট করা
আপনার hosting-এ deploy করার পর `https://YOUR-DOMAIN/api/telegram/webhook` public HTTPS URL হবে।
Telegram webhook সেট করার অনুরোধটি token নিরাপদে রেখে server/নিজের terminal থেকে করুন:
```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$PUBLIC_BASE_URL/api/telegram/webhook\",\"secret_token\":\"$TELEGRAM_WEBHOOK_SECRET\",\"allowed_updates\":[\"channel_post\",\"edited_channel_post\"]}"
```
`TELEGRAM_BOT_TOKEN`, `PUBLIC_BASE_URL`, `TELEGRAM_WEBHOOK_SECRET` shell environment-এ export করা থাকতে হবে। Windows PowerShell-এ values বসিয়ে body পাঠাতে পারেন, তবে token public chat/স্ক্রিনশটে দেখাবেন না।
Webhook status:
```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```
Webhook-এর secret token header যাচাই হয়। Webhook endpoint-এ secret ভুল হলে request reject হবে।

## 4. Mini App চালু করা
1. Hosting-এ `public/index.html` HTTPS URL-এ খুলছে কি না যাচাই করুন।
2. @BotFather → `/mybots` → আপনার bot → **Bot Settings / Configure Mini App** বা **Menu Button** নির্বাচন করুন।
3. Main Mini App URL বা menu button URL হিসেবে `https://YOUR-DOMAIN/` দিন।
4. Telegram app-এ bot chat খুলে Mini App button চাপুন।
5. বাইরে browser-এ UI দেখা যায়, কিন্তু authenticated Mini App API-র `/api/me` endpoint Telegram initData ছাড়া 401 দেবে—এটি ইচ্ছাকৃত।

## 5. কীভাবে কাজ করে
- Channel-এ নতুন post হলে Telegram `channel_post` update webhook-এ পাঠায়।
- Server post metadata JSON file-এ রাখে।
- UI `/api/posts` থেকে পোস্ট নেয় এবং প্রতি 30 সেকেন্ডে refresh করে।
- Photo thumbnail `getFile` দিয়ে server থেকে proxy হয়; bot token frontend-এ নেই।
- Telegram ভিডিওর জন্য বর্তমান V3 card “Open in Telegram” দেয়; Telegram Bot API-এর মাধ্যমে সব ভিডিও সরাসরি stream করার ব্যবস্থা এখানে করা হয়নি।

## সীমাবদ্ধতা ও উৎপাদন-ব্যবহার
- JSON file storage ছোট ডেমোর জন্য। বহু user/উচ্চ ট্রাফিকে SQLite/PostgreSQL এবং persistent disk ব্যবহার করুন।
- Serverless/ephemeral filesystem hosting-এ JSON data restart/deploy-এর পরে হারাতে পারে; persistent disk যুক্ত করুন।
- Bot channel-এ admin না হলে channel post update নাও পেতে পারে।
- Private channel post link-এর জন্য সদস্যপদ/অনুমতি দরকার হতে পারে; private channel-এর media ও post link সব user-এর কাছে খুলবে না।
- Telegram Mini App-এ client `initDataUnsafe` বিশ্বাস করবেন না; server-side signature validation ব্যবহার করুন। এই প্রকল্পের `/api/me` তা যাচাই করে।
- `/api/posts` পাবলিক feed endpoint—শুধু এমন channel content ব্যবহার করুন যা আপনার অ্যাপের audience-এর কাছে দেখানোর অধিকার আপনার আছে।
- Bot token প্রকাশ পেলে BotFather-এ revoke/rotate করুন এবং server environment update করুন।
