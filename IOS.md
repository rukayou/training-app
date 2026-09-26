# iOSアプリとしてビルドする

このリポジトリは、同じソースから**2つの形**で動きます。

| | 動かし方 | 保存先 | オフライン |
|---|---|---|---|
| Web版 | ブラウザ / ホーム画面に追加 | ブラウザのlocalStorage | 対応済み(サービスワーカー) |
| **iOS版** | App Store または Xcodeから直接インストール | アプリ専用の領域 | **通信コードが1行も無い** |

Web版のほうはこれまでどおり Cloudflare Pages へ自動で反映されます。ここではiOS版の手順だけを書きます。

---

## 必要なもの

ビルドと署名はApple製のツールでしか行えないため、**この2つが無いと先に進めません**。

1. **Mac**(Xcode 15以降)。WindowsやLinuxではiOSアプリをビルドできません
2. **Apple ID**
   - 自分のiPhoneに入れて使うだけなら**無料**で足ります(ただし7日ごとに入れ直しが必要)
   - **App Storeで配布する**には **Apple Developer Program(年間 99 USD / 約15,000円)** への加入が必要です

CocoaPodsやRubyの用意は要りません。Capacitor 8 は Swift Package Manager を使うので、Xcodeで開けば依存は自動で解決されます。

---

## 手順

### 1. 取ってくる

```sh
git clone https://github.com/rukayou/training-app.git
cd training-app
npm install
```

Node.js 18以降が必要です(無ければ https://nodejs.org からLTS版を入れてください)。

### 2. Webの中身をアプリへ流し込む

```sh
npm run sync
```

`www/` を作り直し、それを `ios/App/App/public/` へコピーします。**index.html・CSS・JS・フォントを1行でも触ったら、毎回これを実行してください。** 実行し忘れると、アプリの中身は古いままです。

### 3. Xcodeで開く

```sh
npx cap open ios
```

(Xcodeで `ios/App/App.xcodeproj` を直接開いても同じです)

### 4. 署名の設定

1. Xcode左の **App** → **TARGETS: App** → **Signing & Capabilities**
2. **Team** に自分のApple IDを選ぶ(初回は `Add an Account…` からサインイン)
3. **Bundle Identifier** を自分だけの値に変える
   - 今は `com.rukayou.kintorekiroku` が入っています。App Storeに出すなら世界で重複できないので、自分のドメインを逆にしたものなどに変えてください
   - 変えたら `capacitor.config.json` の `appId` も同じ値に揃えます

### 5. 自分のiPhoneへ入れる

1. iPhoneをMacにケーブルで繋ぎ、iPhone側で「このコンピュータを信頼」
2. Xcode上部の実行先で自分のiPhoneを選び、▶ を押す
3. 初回はiPhone側で **設定 → 一般 → VPNとデバイス管理** から開発者を信頼する

これで機内モードでも完全に動きます。**無料のApple IDだと7日で期限が切れる**ので、切れたら手順2〜3をもう一度やってください(記録は消えません)。

### 6. App Storeに出す

Apple Developer Program に加入したうえで:

1. [App Store Connect](https://appstoreconnect.apple.com) で新しいAppを登録(Bundle IDは手順4のもの)
2. Xcodeで実行先を **Any iOS Device (arm64)** にし、**Product → Archive**
3. Organizerで **Distribute App → App Store Connect**
4. App Store Connect側でスクリーンショット・説明文・プライバシー情報を埋める
   - **プライバシー**: このアプリはデータを一切送信しません。「データを収集しない」を選べます
5. **TestFlight** で自分の実機確認 → 問題なければ **審査に提出**

審査はだいたい1〜3日です。

---

## 審査で落ちうる点(先に知っておいてください)

Appleの **App Review ガイドライン 4.2(Minimum Functionality)** は、「Webサイトを包んだだけのアプリ」を明確に拒否対象にしています。このアプリはWeb版と同じ画面を使っているので、**そのままだと弾かれる可能性があります。**

そのため、Webでは実現できない機能を入れてあります。審査で説明を求められたら、この3点を挙げてください。

1. **レスト終了のローカル通知** — 終了時刻をOSに予約するので、アプリを閉じていても・バックグラウンドでも・サイレントスイッチが入っていても確実に鳴ります。Web版はアプリが前面に居ないと鳴らないことがありました
2. **触覚フィードバック** — iOS Safari は `navigator.vibrate` に対応しておらず、Web版では振動が一切出ていませんでした
3. **完全オフライン動作** — 通信先が1つもありません。フォントも同梱済みで、初回起動から機内モードで完結します

それでも弾かれた場合は、ホーム画面ウィジェット(今日のメニュー / 今週の回数)を足すのが次の一手です。ここが一番「Webにはできないこと」として通りやすい部分です。

---

## この構成について

- **ネイティブ判定**は `js/native.js` が `window.Capacitor.isNativePlatform()` で行い、`window.NativeBridge` に公開します。`js/app.js` はこれを `window.NativeBridge?.…` の形でしか触らないので、**ブラウザで開いたときは全て何もしない**まま同じコードが動きます
- ネイティブでは次の3つが自動的に変わります
  - サービスワーカーを登録しない(更新はApp Store経由。毎回サーバーに問い合わせる意味が無い)
  - フッターの「最新の状態に更新」と「最終更新」を出さない
  - はじめ方の案内から「ホーム画面に追加」のステップを抜く(既にインストール済みのため)
- **Capacitorのプラグインを `import` していません。** ネイティブ実行時にブリッジが `window.Capacitor.Plugins` を生やすので、バンドラ無しの今の構成のまま呼べます。ビルド手順を増やさないための判断です
- **フォントは同梱**です(`fonts/` と `css/fonts.css`)。欧文の Plus Jakarta Sans だけで5ウェイト計133KB。和文を同梱していない理由は `css/fonts.css` の冒頭に書いてあります
- **`www/` と `ios/App/App/public/` はビルド生成物**で、gitでは追跡していません。編集してもすぐ上書きされます。直すのはリポジトリのルート側です

## データの引き継ぎについて

**ホーム画面版(Web)の記録は、iOS版には引き継がれません。** 同じ端末でもアプリごとに保存領域が分かれるためで、iOS版は空の状態から始まります。ルーティーンは作り直してください。
