# แยกระบบ admin เป็นโปรเจกต์ `chokprathan-admin` — Design

วันที่: 2026-11-20 · สถานะ: รอ user รีวิว

## เป้าหมาย

แยกระบบหลังบ้าน (admin) ออกจากโปรเจกต์ `chokprathan` เป็นโปรเจกต์ใหม่ `chokprathan-admin` โดย
**ใช้ MariaDB ฐานเดียวกัน แต่แยกตารางพนักงาน (`employees`) ออกจากตารางสมาชิก (`users`)** และแยก
DB user, session, cookie และ deploy ของสองแอปออกจากกัน

ไม่อยู่ในขอบเขต: API ระหว่างสองแอป, message queue, shared package, การย้ายงาน aggregator (AMB).

## สถานะปัจจุบัน (ที่เป็นเหตุผลของการออกแบบ)

- แอปเดียว (Next.js 16 + MariaDB, Mongo/GridFS สำหรับ media) มี admin 26 หน้าที่ `src/app/[lang]/admin/*`,
  `components/admin/*`, `server/actions/admin.ts`, หน้า login ของพนักงานที่ `/console`
- ตาราง `users` ใช้ร่วมทั้ง member และ staff (`role ENUM('member','staff')`, `staff_role_id`, `staff_note`, `totp_*`);
  `sessions`, `login_challenges` ผูก FK กับ `users`
- คอลัมน์ `actor_id` / `created_by` ใน `audit_log`, `transactions`, `bank_account_moves`, `point_moves`,
  `manual_limits`, `vouchers`, `blocklist` เป็น INT **ไม่มี FK** ไปที่ `users`
- `services/scheduler.ts` รวมงานสองฝั่งไว้ใต้ named lock เดียว; `server/cache.ts` เป็น cache ใน process
- `app/media/[name]` ตรวจ `STAFF_COOKIE` เพื่อให้พนักงานดูสลิป

## 1. การแยกข้อมูล

### ตารางใหม่ (admin เป็นเจ้าของ)

| ตาราง | มาจาก |
|---|---|
| `employees` | แถว `role='staff'` ใน `users` (password_hash, totp_*, must_change_password, staff_note, last_login_*, status, employee_role_id) |
| `employee_roles` | `staff_roles` |
| `employee_sessions`, `employee_login_challenges`, `employee_login_attempts`, `employee_auth_log`, `employee_session_ends` | ตารางคู่ขนานฝั่ง member |
| `audit_log` | ความเป็นเจ้าของย้ายมา admin; `actor_id` ชี้ `employees.id` |

**คง id เดิม:** `employees.id = users.id` เดิมของพนักงานคนนั้น จึงไม่ต้องแก้ `actor_id`/`created_by` ในประวัติใดๆ
(คอลัมน์เหล่านี้ไม่มี FK อยู่แล้ว) ตารางพนักงานมี AUTO_INCREMENT ของตัวเอง เริ่มที่ max(id เดิม)+1

### `users` หลังแยก
เหลือเฉพาะ member; ในระยะ contract ลบแถว staff, ลบ FK `users_staff_role_fk`, ตัดคอลัมน์ `staff_role_id`, `totp_*`,
`must_change_password` และลบตาราง `staff_roles` แต่ **เก็บ** `role` และ `staff_note` ไว้ เหตุผล: admin กรอง `role = 'member'`
หลายจุด และใช้ `staff_note` เป็นบันทึกของพนักงานต่อสมาชิก (เป็นข้อมูลสมาชิกจริง) หลัง contract ทุกแถวเป็น `member`
ตัวกรองเดิมจึงยังถูกต้องโดยไม่ต้องแก้โค้ด admin (`role` เหลือเป็นคอลัมน์ค่าเดียว จะลบทีหลังได้เมื่อทั้งสองแอปเลิกกรองด้วยมัน)

### ตารางธุรกิจร่วม (admin อ่าน/เขียนตรง)
`rounds`, `lottos`, `bills`, `bill_items`, `deposits`, `withdrawals`, `transactions`, `bank_accounts`,
`promotions`, `banners`, `news`, `games`, `game_products`, `settings`, `blocklist`, `member_points`, `point_moves`, `manual_limits`, `exposures` ฯลฯ

### DB user และสิทธิ์
- `chok_member`: ตารางฝั่ง member + ตารางธุรกิจร่วมที่ต้องใช้ — **ห้ามเข้าถึง `employee_*` และ `audit_log`**
- `chok_admin`: เฉพาะตารางที่จำเป็น (ไม่ใช่ `ALL`); เขียน `employee_*`, `audit_log` ได้เต็ม
- Schema/migration: admin เป็นเจ้าของ `employee_*` + `audit_log` ด้วยตาราง version ของตัวเอง (`schema_migrations_admin`)
  และ **ไม่สร้างตารางของ member**; member ยังเป็นเจ้าของตาราง member/ธุรกิจร่วม

## 2. โครงสร้าง `chokprathan-admin`

Next.js 16 + stack เดียวกับต้นทาง; ทั้งแอปคือ admin

```
src/app/[lang]/login/        ประตู login (แทน /console)
src/app/[lang]/(panel)/...   26 หน้าเดิม ย้ายมาที่ราก (/members, /rounds, ...)
src/app/media/[name]/        route สลิป (ตรวจ finance.view จาก employee session)
src/domain/                  คัดลอกเฉพาะที่ใช้ (money, schedule, pricing, betTypes, permissions, ...)
src/server/db/               pool + migration ของ employee_*/audit_log
src/server/services/         employees, finance, rounds, settlement, risk, lottos, audit, ...
src/proxy.ts                 ทุกหน้าต้องมี employee session ยกเว้น /login
```

- คงระบบหลายภาษา (dictionary ของ admin/console เดิม)
- **โค้ดที่ใช้ร่วม = คัดลอก (แนวทาง A)** ไม่ทำ shared package; ป้องกัน drift ด้วย parity test (ข้อ 4)

### Auth / session
- cookie `__Host-cpa_session` อ้าง `employee_sessions` เท่านั้น; ไม่อ่าน `users`
- คงกติกาเดิม: TOTP, session 12 ชม., idle 2 ชม., rate-limit login, กัน privilege escalation (`canGrant`/`canActOnRole`)
- deploy บน subdomain แยก (เช่น `admin.<โดเมน>`); IP allowlist ที่ nginx เป็นทางเลือก
- member ตัด `/admin`, `/console`, `STAFF_COOKIE`, และการตรวจ staff ใน proxy ออก

## 3. จุดข้ามแอป

### Scheduler
| ย้ายไป admin | อยู่ฝั่ง member |
|---|---|
| `ensureRounds`, `autoResults`, `resumeSettlements`, `expireDeposits`, `settlePendingGuesses`, `sealAudit`/`verifyAudit`, `rollupStats` | `pruneSessions`, `pruneRateLimits` (ของ member), `syncCatalog`/`closeGameDay` |

- named lock แยก: `chokprathan:scheduler` (member) และ `chokprathan-admin:scheduler` (admin)
- admin ล่ม → รอบ/settlement ล่าช้า (การรับแทงยังถูกจำกัดด้วยเวลาปิดรอบ); ลดความเสี่ยงด้วย 2 replica + named lock
- env `SCHEDULER=off` ใช้ปิดระหว่างการย้าย

### Cache
`server/cache.ts` invalidate ได้เฉพาะใน process; ค่าที่ admin แก้ (settings, banners, lottos, blocklist, theme)
ถึงหน้า member ตาม TTL. งานในแผน: ตรวจ TTL ของ key ที่ admin เขียน และลดให้สั้นสำหรับค่าสำคัญ
(โหมดปิดปรับปรุง, blocklist). ไม่เพิ่มกลไก invalidate ข้ามแอปเว้นแต่ TTL สั้นไม่พอ

### Media
- admin อัปโหลดแบนเนอร์เข้า store เดิม (GridFS / ตาราง `media`); member ส่งแบนเนอร์สาธารณะและสลิปของเจ้าของเอง
- สลิปสำหรับพนักงานเสิร์ฟจาก route ของ admin; ตัดการตรวจ staff ออกจาก route ฝั่ง member
- `chok_admin` ต้องมีสิทธิ์อ่าน/เขียน `media` (และ Mongo ถ้าใช้)

### ความลับ
admin ไม่ได้รับความลับของ AMB เว้นแต่ตรวจแล้วจำเป็น; การเปิด/ปิด `game_products` เป็นแค่การเขียนตารางร่วม

## 4. การทดสอบ

vitest + DB จริงตามรูปแบบเดิม (`src/test/db.ts`, `global-setup.ts`)

- **ย้ายไปพร้อมโค้ด:** `permissions`, `staff` (→ employees), `auth` (employee), `audit-chain`, `rounds`, `money`, `settlement`
- **Migration test:** `users` แบบเก่าที่มี member+staff → (1) staff ไป `employees` ด้วย id เดิมครบ (2) `actor_id`/`created_by`
  เดิมชี้ถูกคน (3) ไม่มี member หลุดมา (4) รันซ้ำแล้วผลเหมือนเดิม
- **Isolation test:** `chok_member` `SELECT employees`/`audit_log` ต้องไม่ได้; `chok_admin` เขียนตารางที่ไม่ได้รับสิทธิ์ไม่ได้
- **Parity test เรื่องเงิน:** fixture ชุดเดียวกันกับ `settlement`, `pricing`, `money` ทั้งสอง repo ต้องได้ผลเท่ากัน
- **ฝั่ง member:** login member ผ่าน; `/admin`, `/console` ได้ 404; `/media` ไม่ส่งสลิปให้คนอื่น
- ก่อนอ้างว่าเสร็จ: `npm test`, `typecheck`, `lint` ทั้งสอง repo

## 5. ลำดับการย้ายและ rollback

1. **Expand:** สร้าง repo ใหม่ + ตาราง `employee_*` + คัดลอก staff (คง id); แอปเดิมยังทำงานปกติ
2. **DB user:** สร้าง `chok_member`/`chok_admin` + GRANT (ยังไม่เปลี่ยน connection แอปเดิม)
3. **ขึ้น admin ใหม่** บน subdomain ใช้ทดลองคู่ขนาน; scheduler ฝั่ง admin ปิดไว้ (`SCHEDULER=off`)
4. **Switch (ปิดปรับปรุงสั้นๆ):** ปิดแอปเดิม → เปิด scheduler ฝั่ง admin → ตัดงานรอบ/settlement ออกจาก member →
   สลับ `DATABASE_URL` ของ member เป็น `chok_member` → ปล่อย member เวอร์ชันที่ลบ `/admin`, `/console`, `STAFF_COOKIE`
5. **Contract** (หลังสังเกตการณ์ ~1–2 สัปดาห์): ลบแถว staff จาก `users`, ตัดคอลัมน์ staff/`totp_*`, ลบ `staff_roles` — **backup `users` และ `staff_roles` ก่อน**

Rollback: ระยะ 1–3 ลบของใหม่ได้โดยไม่กระทบ; ระยะ 4 ย้อนได้ (ข้อมูล staff ใน `users` ยังอยู่ ให้ deploy แอปเดิมกลับและปิด
scheduler ฝั่ง admin); ระยะ 5 ย้อนไม่ได้. ระหว่างระยะ 4–5 ห้ามแก้ข้อมูลพนักงานในแอปเดิม (ทำที่ admin ใหม่เท่านั้น)

## ความเสี่ยงที่เหลือ
- โค้ดเงินมีสองสำเนา → parity test + วินัยแก้ทั้งสอง repo
- ค่าที่ admin แก้ถึง member ช้าตาม TTL
- admin ล่ม → settlement ล่าช้า (2 replica ลดความเสี่ยง)
