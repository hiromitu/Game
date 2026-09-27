# Game

ブラウザで動く小さなゲーム・シミュレーションを集めたリポジトリです。各作品は独立したフォルダに入っていて、ビルドは不要です。

## 作品一覧

| フォルダ | 内容 |
| --- | --- |
| [`aquarium/`](aquarium/) | Three.js で描く 3D アクアリウム。ネオンテトラ・エンゼルフィッシュ・グッピー・コリドラスが種ごとの行動で泳ぎ、水草はポンプの水流で揺れる |
| [`tile-pop/`](tile-pop/) | 同じ色がつながったタイルをクリックして消していくパズル。盤面は必ずクリアできるように作られ、ヒントと「元に戻す」つき。`index.html` を直接開けば遊べる |
| [`color-tiles/`](color-tiles/) | 空きマスをクリックし、上下左右で最も近いタイルのうち同じ色の 2 枚以上を消す「Color Tiles」風パズル。難易度・制限時間・ミスペナルティを切り替えられ、ヒントとベストスコア記録つき。`index.html` を直接開けば遊べる |
| [`punch-runner/`](punch-runner/) | Three.js の 3D アクション。斜め上視点でキャラを動かし、歩く・走る・ジャンプ・よじ登る・パンチでゴールを目指す。地面以外のオブジェクトはすべて殴って壊せる。全 3 ステージ |

## 動かし方

```bash
git clone https://github.com/hiromitu/Game.git
```

- `tile-pop/`・`color-tiles/`：`index.html` をブラウザで直接開けば遊べます。
- `aquarium/`：ローカルサーバーが必要です。手順は [`aquarium/README.md`](aquarium/README.md) を参照してください。
- `punch-runner/`：ローカルサーバーが必要です。手順は [`punch-runner/README.md`](punch-runner/README.md) を参照してください。
