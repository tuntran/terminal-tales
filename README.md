# Terminal Tales

Một game idle RPG sống ngay trong Claude Code. Một đội 1–3 anh hùng pixel đánh quái
trên dải phía trên ô prompt trong lúc bạn code. Mỗi lần Claude gọi tool, đội nhận
vàng và EXP; mỗi lần chạy test xanh, đội nhận thưởng lớn kèm một món đồ. Việc bạn
làm (gửi prompt, cho phép quyền, commit, bấm Esc…) buff đội hoặc buff quái. Mọi cửa
sổ Claude Code CLI trên một máy cùng xem một trận chung, và tiến trình được lưu lại
giữa các session.

Cảnh đánh nhau là một ảnh pixel art chuyển động khoảng 10 khung mỗi giây: phông nền
đổi theo ải, anh hùng và quái có đủ động tác đứng, đánh, trúng đòn, gục, cùng mũi
tên, đạn phép, số damage và hình cho từng hiệu ứng.

**Yêu cầu terminal:** cần terminal hiện được ảnh qua kitty graphics (kitty,
Ghostty, Orca…) và dải rộng ít nhất 69 cột, cao 8 dòng. Không có fallback: terminal
không hiện được ảnh, dải quá nhỏ, hoặc Claude Code Desktop chỉ hiện một dòng báo lỗi
thay cho cảnh; game vẫn chạy bình thường và bảng `/hero` vẫn dùng được.

## Cách chơi

- **Dải chiến đấu**: tự chạy mỗi 1,5 giây khi session mở. Hạ đủ 10 quái thì Boss
  xuất hiện; hạ Boss để qua ải, quái mạnh hơn và rơi đồ tốt hơn. Cả đội gục thì
  nghỉ một lát rồi chiến tiếp, không mất gì.
- **Hoạt động code**:
  - Mỗi tool call hoàn tất: một ít vàng, EXP và một đòn đánh miễn phí.
  - Lệnh Bash chạy test (`npm test`, `pnpm test`, `vitest`, `jest`, `pytest`,
    `go test`, `cargo test`, `mix test`, `rspec`, …) mà không lỗi: thưởng lớn, chắc
    chắn rơi một món đồ với tỉ lệ hiếm cao hơn, kèm thông báo.
  - Game chỉ quan sát: nó không bao giờ chặn hay sửa tool call, prompt hay quyết
    định quyền của bạn.
- **Hiệu ứng theo action**: mỗi action một hiệu ứng, hiện trên dải chiến đấu
  (`Đội …` màu xanh, `Quái …` màu đỏ).

  | Action | Phe | Hiệu ứng |
  | --- | --- | --- |
  | Gửi prompt | Đội | Hô khiến: 30 giây, mỗi bước 20% cơ hội cả đội đánh thêm một lượt |
  | Turn trả lời xong | Đội | Tiếp sức: anh hùng còn đứng hồi 15% máu |
  | Cho phép quyền trong hộp thoại | Đội | Tin tưởng: 30 giây, +10% chí mạng |
  | `git commit` thành công | Đội | Cột mốc: khiên chặn đòn kế tiếp của quái |
  | `/compact` thủ công | Đội | Tĩnh tâm: anh hùng còn đứng hồi đầy máu |
  | Esc huỷ turn | Quái | Nổi giận: 30 giây, quái +25% sát thương |
  | Từ chối quyền trong hộp thoại | Quái | Giáp đá: chặn 2 lượt đánh kế tiếp của cả đội |
  | Lệnh Bash lỗi (không tính lệnh bị ngắt) | Quái | Tái sinh: quái hồi 20% máu |

  Cùng một hiệu ứng thì không cộng dồn, chỉ làm mới thời hạn. Thời hạn tính theo
  bước chiến đấu nên dừng đếm khi không có session nào. Không hiệu ứng nào lấy
  vàng, đồ hay cấp, và hồi máu không hồi sinh anh hùng đã gục. Hai action quyền chỉ
  tính khi chính bạn trả lời hộp thoại: ở chế độ auto, acceptEdits, bypass hay
  dontAsk, hoặc khi một rule hay hook quyết định thay, chúng không xảy ra.
- **`/hero`**: mở bảng anh hùng để xem chỉ số, trang bị, tháo/lắp đồ, nâng cấp đồ
  đang mặc, bán đồ trong túi và chiêu mộ thêm anh hùng (tối đa 3).
- **Lớp nhân vật**: Kiếm Sĩ (máu trâu), Pháp Sư (sát thương cao, máu giấy), Xạ Thủ
  (chí mạng cao).
- **Độ hiếm**: quái có Thường, Tinh Anh, Hiếm, Boss; đồ có Thường, Khá, Hiếm,
  Sử Thi, Huyền Thoại.

Thu gọn dải bằng `[-]` hoặc `ctrl+x ctrl+a`.

## Nhiều cửa sổ, một trận

Trên Claude Code CLI, plugin khởi động một **tiến trình nền** (daemon) giữ trận chung
của máy: nó chạy vòng chiến đấu, nhận action từ mọi cửa sổ và lưu tiến trình. Các
cửa sổ chỉ gửi action và vẽ trận nó trả về, nên `/hero` ở cửa sổ này hiện ngay ở
cửa sổ kia, và đóng một cửa sổ không làm dừng trận ở các cửa sổ còn lại.

- Cần `node` hoặc `bun` trên máy (ưu tiên `node`). Daemon chạy với quyền của người
  dùng hiện tại, nghe trên Unix socket trong thư mục riêng quyền `0700`, không mở cổng
  mạng nào.
- Dữ liệu nằm ở `~/.claude/tt/<installId>/`: `world.json` (trận chung), `d.sock`,
  `daemon.lock`, `daemon.log`. `installId` được tạo một lần trong store của plugin,
  nên cập nhật plugin vẫn giữ tiến trình, còn bản `--plugin-dir` và bản cài từ
  marketplace vẫn có trận riêng.
- Daemon tự thoát khoảng 15 giây sau khi cửa sổ cuối cùng đóng, xoá `d.sock` và
  `daemon.lock`. Cửa sổ kế tiếp tự khởi động lại nó. Trận đứng yên khi không còn cửa
  sổ nào.
- Lần đầu chạy, save cũ trong store được chuyển sang `world.json` đúng một lần (save
  cũ vẫn được giữ nguyên trong store).
- `world.json` không đọc được thì được giữ lại dưới tên `world.unreadable-<ts>.json`
  rồi bắt đầu trận mới; `world.json` do phiên bản mới hơn tạo thì không bao giờ bị
  ghi đè.

**Chế độ chạy một mình.** Không có `node` hay `bun`, trên Claude Code Desktop, hoặc
khi daemon không khởi động được, cửa sổ đó tự chạy trận riêng và lưu vào store của
plugin như trước, kèm một thông báo; nó không bao giờ ghi vào `world.json`. Cứ 30 giây
nó thử tìm daemon lại. Nếu daemon chưa có trận, trận chơi một mình được chuyển sang
daemon; nếu daemon đã có trận, phần chơi một mình kể từ lần chuyển trước bị bỏ.

## Chạy từ mã nguồn

Cần Claude Code 2.1.292 trở lên (API function hooks đang ở giai đoạn early access).

```sh
claude --plugin-dir /đường/dẫn/tới/terminal-tales
```

Trận chung nằm ở `~/.claude/tt/<installId>/world.json` (xem phần trên). Store riêng
của plugin dưới thư mục cấu hình Claude Code (`~/.claude/plugins/store/`) giữ
`installId` và save của chế độ chạy một mình. Store gắn với cách plugin được nạp,
nên bản chạy bằng `--plugin-dir` và bản cài từ marketplace có trận riêng.

## Cài từ GitHub

Repo này đồng thời là một marketplace (`.claude-plugin/marketplace.json`). Cài bằng
một dòng gõ tại prompt của Claude Code:

```
/plugin install terminal-tales --marketplace tuntran/terminal-tales
```

Trả lời `y` để thêm marketplace, rồi chọn phạm vi (user).

## Xem trước ngoài Claude Code

```sh
bun scripts/preview.tsx                 # dải chiến đấu và bảng /hero (ảnh qua kitty graphics)
bun scripts/preview.tsx --watch         # dải chiến đấu chuyển động
bun scripts/preview.tsx --html out.html # cùng nội dung dưới dạng trang web
bun scripts/pixel-preview.ts             # chỉ cảnh chiến đấu, chuyển động ngay trong terminal
bun scripts/pixel-preview.ts --html out.html  # cảnh chiến đấu chuyển động trong trình duyệt
```

## Phát triển

```sh
claude plugin validate .   # kiểm tra manifest và hooks module như engine sẽ đọc
claude plugin test .       # chạy tests/*.test.ts(x) trên engine thật
npx -p typescript tsc -p . # type-check (sau lần nạp đầu, engine đặt types vào .claude-plugin/types/)

bun install                # @types/bun cho daemon, pngjs cho script build ảnh
bun run build:assets       # đóng gói assets/source/ thành assets/build/*.bin và src/ui/atlas-manifest.ts
bun run check:assets       # assets/build/ và manifest phải khớp bản build từ assets/source/
bun test daemon            # test daemon (daemon/*.spec.ts)
bun run build:daemon       # bundle daemon/ vào dist/ (chạy được bằng node hoặc bun)
bun run check:daemon       # dist/ phải khớp đúng bản build từ daemon/; bắt buộc khi sửa daemon/
npx -p typescript tsc -p daemon
bash scripts/acceptance.sh [--sessions]  # nghiệm thu trên máy thật; --sessions chạy claude -p
```

`dist/` được commit vì plugin chạy nó trực tiếp bằng `node` hoặc `bun`. Đừng sửa tay
`dist/`: sửa `daemon/` rồi build lại, và `check:daemon` sẽ báo nếu hai bên lệch nhau.

`assets/build/` cũng được commit: hook module không giải mã được PNG, nên
`scripts/build-assets.ts` giải mã sẵn sprite sheet và phông nền thành bảng màu cộng
chỉ số 8 bit, và plugin nạp chúng một lần mỗi session. Đổi ảnh hay cách cắt clip thì
sửa `assets/source/` hoặc cấu hình trong script, chạy `build:assets`, rồi để
`check:assets` xác nhận.

Một daemon đang chạy chỉ nhường chỗ cho plugin có `version` mới hơn hẳn; hai bản build
cùng `version` dùng chung daemon đang có, để chúng không tắt nhau qua lại. Khi sửa
`daemon/` mà chưa nâng `version`, hãy dừng daemon cũ (`kill` pid trong
`~/.claude/tt/<installId>/daemon.lock`) để session kế tiếp chạy bản mới.

Cấu trúc:

| Đường dẫn | Vai trò |
| --- | --- |
| `hooks/register.tsx` | Nối game vào Claude Code: nhận diện action, thưởng theo tool call, lệnh `/hero`, vẽ dải và pane |
| `src/sync/client.ts` | Tìm hoặc khởi động daemon, long-poll trận chung, outbox gửi action chạy nền, chế độ chạy một mình |
| `daemon/` | Daemon: server trên Unix socket (`server.ts`), launcher tách tiến trình (`launch.ts`), giao thức dùng chung (`protocol.ts`) |
| `dist/` | Bản bundle của `daemon/` mà plugin chạy |
| `src/game/engine.ts` | Luật chơi thuần, tất định theo seed: chiến đấu, rơi đồ, lên cấp, hành động trong `/hero`, đọc save |
| `src/game/catalog.ts` | Dữ liệu: lớp nhân vật, quái và sprite sheet của từng loại, độ hiếm, tên đồ, hằng số cân bằng |
| `src/game/test-command.ts` | Nhận diện lệnh chạy test, kết quả xanh, `git commit`, lệnh lỗi và lệnh bị từ chối |
| `src/ui/` | Dải phía trên prompt (diễn biến và vẽ khung trong `animation.ts`, nạp ảnh trong `atlas.ts`, phép vẽ RGBA trong `frame-buffer.ts`) và bảng `/hero` |
| `assets/` | Ảnh nguồn (`source/`), bản đóng gói plugin nạp (`build/`) và [ghi công](assets/CREDITS.md) |
| `scripts/` | Đóng gói ảnh; xem trước dải và bảng trong terminal hoặc trình duyệt; nghiệm thu daemon |
| `types/index.d.ts` | Kiểu dữ liệu game và hợp đồng `$.state` của plugin |
| `tests/` | Test logic game và test tích hợp qua engine, với một daemon giả trong bộ nhớ |

## Ghi chú

Lấy cảm hứng từ thể loại idle RPG. Mã nguồn mở theo giấy phép [MIT](LICENSE).

Ảnh nhân vật và phông nền đến từ các gói CC0 của LuizMelo và Luis Zuno (ansimuz), và
các gói phông nền CC-BY 4.0 của Admurin. Danh sách đầy đủ và giấy phép từng gói nằm
trong [assets/CREDITS.md](assets/CREDITS.md); khi phân phối lại plugin, giữ file này.
