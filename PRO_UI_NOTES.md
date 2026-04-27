# LAN Drive Pro UI 改修メモ

日付: 2026-04-24

## 今回の方針

既存機能は維持し、売れる見た目と使いやすさを優先して画面を整理した。

参考にした方向性:

- Dropbox: 左のファイル導線、上部検索、作成/アップロードの明確化
- Microsoft Fluent: 情報密度と快適さのバランス、コンパクトな管理画面
- Atlassian: 上部の主要導線、低頻度機能の整理、迷わないナビゲーション

## 実装したUI改善

- ブランドを `LAN Drive Pro` に変更
- 上部に「LAN専用」ステータスを追加
- 現在地、表示件数、選択数、プレビュー中ファイルの概要カードを追加
- ファイル一覧に専用ヘッダーとクイック操作を追加
- プレビュー側に専用ヘッダー、詳細、パスコピー、閉じるを追加
- デスクトップで左右ペインをカード化
- モバイルで横スクロールしないレスポンシブ調整
- 閉じているチャットを小さいフローティングピルに変更
- faviconを追加して404を解消
- JSでファイル一覧再描画後も概要カードが更新されるようにした

## 追加実装したPro機能

- 初回起動ウィザードを追加
  - 画面名と共有キーの有無を最初に設定できる
  - 初回は必須モーダルとして表示し、設定後に共有QRへつなげる
- 共有キー認証を追加
  - `.state/app_settings.json` に設定を保存
  - 共有キーはソルト付きSHA-256ハッシュで保存
  - 未認証端末は `/unlock` に誘導
- 共有QRを強化
  - LAN内URL、IP表示、共有キーON/OFF表示、コピー操作を追加
  - `qrcode-generator` が読める環境では実際にスキャン可能なQRを生成
- 共有設定モーダルを追加
  - 画面名の変更
  - 共有キーON/OFF
  - 共有キー変更

## 動作確認

- `node --check static/script.js`: OK
- `python -m py_compile app.py`: OK
- `http://localhost:5000/`: 200 OK
- Playwright + Chromeでデスクトップ表示確認: JSエラーなし
- Playwright + Chromeでモバイル表示確認: 横スクロールなし
- `URL.txt` のプレビュー確認: JSエラーなし
- 初回セットアップ表示確認: JSエラーなし
- 共有QR表示確認: JSエラーなし、QR canvas描画あり
- 共有キーON時の未認証API拒否/ログイン後許可をテストクライアントで確認

## 2026-04-24 メンテナンス記録

- プレビュー操作の見直し
  - 編集/比較ボタンをプレビュー本文からヘッダーへ移動
  - テキスト/画像など対応形式だけ操作ボタンを表示
- 上部概要カードの表示切替を追加
  - 「現在の場所」「表示中」「選択中」「プレビュー」のカードをツールバーからON/OFF可能
  - 表示状態はブラウザに保存し、再読み込み後も維持
- 受け取り専用モードを追加
  - `/receive` でスマホ向けアップロード専用画面を表示
  - メイン画面から大きい受け取りQRを表示
  - ダウンロード/編集を見せず、写真・動画・書類の受け取りに特化
- 共有/運用設定を拡張
  - ポート、保存先、アップロード上限、共有リンク期限をUIから設定
  - アップロード上限はクライアント側とサーバー側の両方で確認
  - 保存先は保存後すぐ切り替え、ポートは再起動後に反映
- ターミナルを管理者モード配下に整理
  - 既定では非表示
  - 管理者モードON、かつこのPC上のブラウザだけで表示
- Windows用GUIランチャーを追加
  - `launcher.pyw` と `build_launcher.bat`
  - `dist/LAN Drive Pro Launcher.exe` を生成済み
- パス検証を `startswith` から `os.path.commonpath` ベースへ変更
  - `../files_evil/...` のような紛らわしいパスを確実に拒否する
- アップロード時の走査対策を強化
  - 無効な相対パスだけだった場合は `400 No valid files received` を返す
- 初回セットアップ必須モーダルのEscape抜けを防止
  - 初回設定完了前はEscapeでも閉じない
- 共有キー設定が壊れた状態でもロックアウトしないよう保護
  - キーハッシュ/ソルトがない場合は共有キー強制を行わない
- ターミナル機能を本体PC限定に変更
  - LAN内の別端末からは `/api/terminal/run` を `403` で拒否
  - `X-Forwarded-For` 偽装では許可しない
  - 別端末の画面ではターミナルメニューを表示しない
- SaaS風ダッシュボードを追加
  - 今日の受信数、共有リンク数、保存容量、現在位置、表示件数、選択/プレビューを上部で一覧化
  - `/api/dashboard` で直近ファイル、今日追加分、共有リンク数を取得
- 受信箱ウィジェットと受信箱サイドパネルを追加
  - 最近届いた/更新されたファイルを上部に表示
  - ツールメニューとダッシュボードから受信箱を開ける
- ダッシュボード配置を再整理
  - 6枚カード型から、受付ヘッダー + コンパクト指標 + 受信箱へ変更
  - モバイルでは受信箱を2件表示、チャットは小さな丸ボタンに圧縮

追加確認:

- `safe_path` のディレクトリトラバーサル拒否: OK
- 不正アップロード名の拒否: OK
- 正常アップロード: OK
- 初回セットアップ必須モーダルのEscape耐性: OK
- 現行画面のJSエラーなし: OK
- プレビュー編集/比較ボタンのヘッダー移設: OK
- 上部概要カードのON/OFFと状態保存: OK
- 受け取り専用QRの表示: OK
- `/receive` 受け取り専用ページ: OK
- 設定画面のポート/保存先/上限/期限表示: OK
- ターミナル既定非表示: OK
- WindowsランチャーEXE生成: OK
- ローカル端末からのターミナル実行: OK
- LAN内別端末相当のターミナル拒否: OK
- `X-Forwarded-For` 偽装時のターミナル拒否: OK
- SaaS風ダッシュボード表示: OK
- 受信箱サイドパネル表示: OK
- モバイル横スクロールなし: OK

確認スクリーンショット:

- `.ui-backups/pro-ui-check-final.png`
- `.ui-backups/pro-ui-mobile-check-2.png`
- `.ui-backups/pro-ui-preview-check.png`
- `.ui-backups/pro-setup-wizard-check.png`
- `.ui-backups/pro-setup-mobile-check.png`
- `.ui-backups/pro-share-qr-check.png`
- `.ui-backups/maintenance-setup-escape-check.png`
- `.ui-backups/maintenance-qr-check-2.png`
- `.ui-backups/preview-header-actions-check.png`
- `.ui-backups/preview-header-actions-mobile-check.png`
- `.ui-backups/command-deck-toggle-desktop.png`
- `.ui-backups/command-deck-toggle-mobile.png`
- `.ui-backups/command-deck-hidden-desktop.png`
- `.ui-backups/command-deck-hidden-mobile.png`
- `.ui-backups/sales-desktop.png`
- `.ui-backups/sales-mobile.png`
- `.ui-backups/sales-preview.png`
- `.ui-backups/sales-share-qr.png`
- `.ui-backups/sales-history.png`
- `.ui-backups/sales-receive-qr.png`
- `.ui-backups/sales-receive-page.png`
- `.ui-backups/sales-settings.png`
- `.ui-backups/saas-dashboard-desktop.png`
- `.ui-backups/saas-dashboard-mobile.png`
- `.ui-backups/saas-inbox-panel.png`
- `.ui-backups/saas-dashboard-refined-desktop.png`
- `.ui-backups/saas-dashboard-refined-mobile.png`

## 次に売れるレベルへ近づける追加案

1. Windows配布用ランチャー
   - `server.bat` より見た目のよい `LAN Drive Pro.exe` または簡易ランチャーを作る

2. 受け取り専用モード
   - QRだけを大きく表示し、スマホからこのPCへアップロードする用途に特化する

3. 設定画面の拡張
   - ポート、保存先、アップロード上限、共有リンク期限をUIで変更できるようにする

4. 販売ページ用のスクリーンショット整備
   - デスクトップ、スマホ、プレビュー、共有リンク、履歴画面の5枚を用意する

5. 危険機能のPro向け整理
   - ターミナル機能は強力だが販売時には「管理者モードでのみ表示」などの切り替えが望ましい
