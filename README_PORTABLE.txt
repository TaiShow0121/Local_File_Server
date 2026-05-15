LAN Drive Pro Portable
======================

別PCでの起動方法
----------------

1. ZIPを好きな場所に解凍します。
2. start_lan_drive_pro.bat をダブルクリックします。
3. LAN Drive Pro Server.exe が入っている場合は、そのまま起動します。
4. EXEがない場合だけ、初回に .venv が作成され、必要なPythonパッケージが入ります。
5. ブラウザで http://127.0.0.1:5000/ が開きます。

GUIランチャーで起動したい場合は start_launcher.bat を使ってください。

必要なもの
----------

- Windows
- LAN Drive Pro Server.exe がある場合: Python不要
- EXEなしで動かす場合: Python 3.10以上、初回セットアップ時のインターネット接続

Pythonが入っていない場合
------------------------

https://www.python.org/downloads/windows/ から Python 3.10 以上を入れてください。
インストール時に "Add python.exe to PATH" を有効にしてください。

同じLAN内のスマホ/別PCから開く
-----------------------------

アプリ起動後、画面上の「受付QR」または「共有QR」を表示してください。
スマホ側は同じWi-Fi/LANに接続してQRを読み取ればアップロードできます。

配布ZIPに含めないもの
--------------------

以下は別PCへ持ち出さない想定です。

- .git
- .state
- .history
- .trash
- .favs
- .ui-backups
- __pycache__
- 既存の files 内データ

注意
----

このアプリはLAN内利用向けです。インターネットへ直接公開しないでください。
