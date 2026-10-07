# Terminal Tales

Một game idle RPG sống ngay trong Claude Code. Một đội 1–3 anh hùng pixel đánh quái
trên dải phía trên ô prompt trong lúc bạn code. Mỗi lần Claude gọi tool, đội nhận
vàng và EXP; mỗi lần chạy test xanh, đội nhận thưởng lớn kèm một món đồ. Tiến trình
được lưu lại giữa các session.

Trên terminal có truecolor, cảnh đánh nhau được vẽ bằng pixel (mỗi ô terminal là
hai pixel xếp dọc) và cần khoảng 70 cột × 9 dòng. Khi terminal hẹp hoặc thấp
hơn, và trên Claude Code Desktop, dải tự chuyển sang hình ASCII gọn hơn.

## Cách chơi

- **Dải chiến đấu**: tự chạy mỗi 1,5 giây khi session mở. Hạ đủ 10 quái thì Boss
  xuất hiện; hạ Boss để qua ải, quái mạnh hơn và rơi đồ tốt hơn. Cả đội gục thì
  nghỉ một lát rồi chiến tiếp, không mất gì.
- **Hoạt động code**:
  - Mỗi tool call hoàn tất: một ít vàng, EXP và một đòn đánh miễn phí.
  - Lệnh Bash chạy test (`npm test`, `pnpm test`, `vitest`, `jest`, `pytest`,
    `go test`, `cargo test`, `mix test`, `rspec`, …) mà không lỗi: thưởng lớn, chắc
    chắn rơi một món đồ với tỉ lệ hiếm cao hơn, kèm thông báo.
  - Game chỉ quan sát: nó không bao giờ chặn hay sửa tool call của Claude.
- **`/hero`**: mở bảng anh hùng để xem chỉ số, trang bị, tháo/lắp đồ, nâng cấp đồ
  đang mặc, bán đồ trong túi và chiêu mộ thêm anh hùng (tối đa 3).
- **Lớp nhân vật**: Kiếm Sĩ (máu trâu), Pháp Sư (sát thương cao, máu giấy), Xạ Thủ
  (chí mạng cao).
- **Độ hiếm**: quái có Thường, Tinh Anh, Hiếm, Boss; đồ có Thường, Khá, Hiếm,
  Sử Thi, Huyền Thoại.

Thu gọn dải bằng `[-]` hoặc `ctrl+x ctrl+a`.

## Chạy từ mã nguồn

Cần Claude Code 2.1.292 trở lên (API function hooks đang ở giai đoạn early access).

```sh
claude --plugin-dir /đường/dẫn/tới/terminal-tales
```

Tiến trình nằm trong store riêng của plugin dưới thư mục cấu hình Claude Code
(`~/.claude/plugins/store/`). Store gắn với cách plugin được nạp, nên bản chạy bằng
`--plugin-dir` và bản cài từ marketplace có save riêng.

## Cài từ GitHub

Repo này đồng thời là một marketplace (`.claude-plugin/marketplace.json`). Cài bằng
một dòng gõ tại prompt của Claude Code:

```
/plugin install terminal-tales --marketplace tuntran/terminal-tales
```

Trả lời `y` để thêm marketplace, rồi chọn phạm vi (user).

## Xem trước ngoài Claude Code

```sh
bun scripts/preview.tsx                 # dải chiến đấu và bảng /hero, có màu
bun scripts/preview.tsx --watch         # dải chiến đấu chuyển động
bun scripts/preview.tsx --html out.html # cùng nội dung dưới dạng trang web
bun scripts/pixel-preview.ts             # hoạt ảnh pixel ngay trong terminal
bun scripts/pixel-preview.ts --html out.html  # hoạt ảnh pixel trong trình duyệt
```

## Phát triển

```sh
claude plugin validate .   # kiểm tra manifest và hooks module như engine sẽ đọc
claude plugin test .       # chạy tests/*.test.ts(x) trên engine thật
npx -p typescript tsc -p . # type-check (sau lần nạp đầu, engine đặt types vào .claude-plugin/types/)
```

Cấu trúc:

| Đường dẫn | Vai trò |
| --- | --- |
| `hooks/register.tsx` | Nối game vào Claude Code: timer chiến đấu, thưởng theo tool call, lệnh `/hero`, vẽ dải và pane, lưu tiến trình |
| `src/game/engine.ts` | Luật chơi thuần, tất định theo seed: chiến đấu, rơi đồ, lên cấp, hành động trong `/hero`, đọc save |
| `src/game/catalog.ts` | Dữ liệu: lớp nhân vật, quái, độ hiếm, tên đồ, sprite ASCII, hằng số cân bằng |
| `src/game/test-command.ts` | Nhận diện lệnh chạy test và kết quả xanh |
| `src/ui/` | Dải phía trên prompt (pixel trong `pixel-art.ts`, ASCII trong `art.ts`) và bảng `/hero` |
| `scripts/` | Xem trước dải và bảng trong terminal hoặc trình duyệt |
| `types/index.d.ts` | Kiểu dữ liệu game và hợp đồng `$.state` của plugin |
| `tests/` | Test logic game và test tích hợp qua engine |

## Ghi chú

Lấy cảm hứng từ thể loại idle RPG; mọi tên, hình và dữ liệu trong game là của riêng
dự án. Mã nguồn mở theo giấy phép [MIT](LICENSE).
