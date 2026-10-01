# Checklist ตั้งค่า GitHub สำหรับเจ้าของ repo

เอกสารนี้เป็น checklist สำหรับเจ้าของ repository ให้รันเองจากเครื่องที่มี
สิทธิ์และ network พร้อมแล้ว งานนี้ไม่ได้รัน gh, ไม่แตะ remote และไม่ลบ branch
ใด ๆ

## สถานะที่ตรวจจาก checkout นี้

คำสั่ง git branch -r --merged origin/main จาก checkout นี้แสดงเพียง
origin/HEAD -> origin/main และ origin/main ดังนั้นยังไม่มี branch ต่อไปนี้อยู่ใน
รายชื่อที่ยืนยันว่า merged แล้ว:

- experiment/prisma
- research/payment-providers
- claude/*
- codex/*

ให้ fetch และตรวจ PR/commit บน GitHub อีกครั้งก่อนลบ เพราะรายชื่อ local remote
อาจเก่า และ wildcard ต้องขยายเป็นชื่อ branch จริง

~~~powershell
git fetch --all --prune
git branch -r --merged origin/main
gh pr list --state merged --base main --limit 100
~~~

กำหนด repository เป็น OWNER/REPO ของจริงก่อนรันคำสั่งถัดไป

~~~powershell
$repo = "OWNER/REPO"
gh repo view $repo
~~~

## Branch และ merge policy

ตั้ง main เป็น default branch, เปิดลบ head branch หลัง merge และให้ squash เป็น
วิธี merge หลัก:

~~~powershell
gh repo edit $repo --default-branch main --delete-branch-on-merge --enable-squash-merge --enable-merge-commit=false --enable-rebase-merge=false
~~~

ป้องกัน main ให้ทุก change ผ่าน pull request และ status check `Quality checks`
(ชื่อ job ใน `.github/workflows/ci.yml`) ก่อน merge ค่าที่ตั้งไว้จริงใช้ approval 0 คน
และไม่บังคับกับ admin เพราะ repo มีเจ้าของคนเดียว (ถ้าบังคับ approval 1 คน
เจ้าของจะ merge PR ของตัวเองไม่ได้) คำสั่งนี้ต้องรันใน shell ที่รองรับ heredoc:

~~~bash
repo="OWNER/REPO"
gh api --method PUT "repos/$repo/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Quality checks"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
~~~

ตรวจผล:

~~~powershell
gh api "repos/$repo/branches/main/protection"
~~~

## ลบ merged branches

ลบเฉพาะ branch ที่ตรวจแล้วว่า merge เข้า main และไม่มีงานที่ต้องเก็บไว้:

~~~powershell
git branch -r --merged origin/main
gh pr list --state merged --base main --head experiment/prisma
gh pr list --state merged --base main --head research/payment-providers
~~~

หลังยืนยันชื่อจริงแล้ว ค่อยลบทีละ branch:

~~~powershell
gh api --method DELETE "repos/$repo/git/refs/heads/experiment/prisma"
gh api --method DELETE "repos/$repo/git/refs/heads/research/payment-providers"
~~~

สำหรับ claude/* และ codex/* ให้ดูรายชื่อจริงจาก git branch -r --merged
origin/main หรือ gh api ก่อน แล้วแทนชื่อจริงในคำสั่ง DELETE ห้ามส่ง wildcard
ไปยัง API โดยตรง

## Description, topics และ labels

ปรับคำอธิบายและหัวข้อให้ค้นหา repo ได้ง่าย:

~~~powershell
gh repo edit $repo --description "ระบบจัดการร้านอาหารตามสั่งและการสั่งอาหารออนไลน์" --add-topic restaurant --add-topic ordering --add-topic typescript --add-topic react --add-topic supabase
~~~

สร้างหรืออัปเดต labels มาตรฐาน:

~~~powershell
gh label create bug --color D73A4A --description "สิ่งที่ทำงานผิด" --force
gh label create enhancement --color A2EEEF --description "ความสามารถใหม่หรือการปรับปรุง" --force
gh label create documentation --color 0075CA --description "งานเอกสาร" --force
gh label create dependencies --color 0366D6 --description "dependency update" --force
gh label create security --color B60205 --description "ประเด็นความปลอดภัย" --force
gh label create ci --color 5319E7 --description "งาน CI/CD" --force
gh label create good-first-issue --color 7057FF --description "เหมาะสำหรับผู้เริ่มต้น" --force
~~~

## Final verification

- [ ] default branch เป็น main
- [ ] branch protection บังคับ PR และ status check `Quality checks`
- [ ] เปิด auto-delete head branches แล้ว
- [ ] merge policy ใช้ squash และปิด merge commit/rebase ตามนโยบายทีม
- [ ] labels และ topics ปรากฏในหน้า repository
- [ ] ลบเฉพาะ branch ที่ยืนยัน merged แล้ว
- [ ] ยังไม่มี LICENSE จนกว่าเจ้าของจะตัดสินใจและเพิ่มอย่างเป็นทางการ
