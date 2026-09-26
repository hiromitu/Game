# Game

ブラウザで動く小さなゲーム・シミュレーションを集めたリポジトリです。各作品は独立したフォルダに入っていて、ビルドは不要です。

## 作品一覧

| フォルダ | 内容 |
| --- | --- |
| [`aquarium/`](aquarium/) | Three.js で描く 3D アクアリウム。ネオンテトラ・エンゼルフィッシュ・グッピー・コリドラスが種ごとの行動で泳ぎ、水草はポンプの水流で揺れる |
| [`tile-pop/`](tile-pop/) | 同じ色がつながったタイルをクリックして消していくパズル。盤面は必ずクリアできるように作られ、ヒントと「元に戻す」つき。`index.html` を直接開けば遊べる |

## 動かし方

Python 3 が入っていれば動きます。

```bash
git clone https://github.com/hiromitu/Game.git
cd Game/aquarium
python serve.py
```

ブラウザで http://localhost:8765/ を開きます。ES Modules を使っているため、`index.html` をファイルとして直接開いても動きません。詳しくは各フォルダの README を参照してください。
