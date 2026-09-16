import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  findMigrationFile,
  isAlterTableAddColumnStatement,
  isDuplicateColumnError,
  splitSqlStatements,
} from "../src/store.js";

describe("mysql migration runner hardening", () => {
  it("ไม่ตัด statement ตรง semicolon ใน line comment", () => {
    const sql = [
      "-- หนึ่งรอบผูกกับการจองได้หนึ่งครั้ง (UNIQUE reservation_id;",
      "-- NULL ได้หลายแถวสำหรับรอบ walk-in)",
      "CREATE TABLE t (id INT PRIMARY KEY);",
    ].join("\n");
    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("CREATE TABLE t");
    expect(statements[0]).toContain("UNIQUE reservation_id;");
  });

  it("ไม่ตัด semicolon ใน block comment, string, และ identifier", () => {
    const sql = [
      "/* block; comment */",
      "CREATE TABLE t (note VARCHAR(20) DEFAULT ';', name VARCHAR(20) DEFAULT \";\");",
      "ALTER TABLE `t;weird` ADD COLUMN c INT;",
    ].join("\n");
    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("DEFAULT ';'");
    expect(statements[1]).toContain("ADD COLUMN c INT");
  });

  it("ข้าม statement ที่เป็น comment-only/empty", () => {
    expect(splitSqlStatements("/* แค่คอมเมนต์ */; SELECT 1;")).toEqual(["SELECT 1"]);
    expect(splitSqlStatements(";; SELECT 1;;")).toEqual(["SELECT 1"]);
    // `;` ใน line comment ต้องไม่แตก statement (รวมกับ SELECT ข้างล่างเป็นชิ้นเดียว)
    const merged = splitSqlStatements("-- แค่คอมเมนต์;\nSELECT 1;");
    expect(merged).toHaveLength(1);
    expect(merged[0]).toContain("SELECT 1");
  });

  it("ไฟล์ 007 จริงแตกเป็น 4 statements ที่รันได้ (ไม่ malformed)", () => {
    const sql = readFileSync(findMigrationFile("007_reservations.sql"), "utf8");
    const statements = splitSqlStatements(sql);
    // 2 CREATE TABLE + 2 ALTER TABLE ADD COLUMN
    expect(statements).toHaveLength(4);
    expect(statements[0]).toContain("CREATE TABLE IF NOT EXISTS reservations");
    expect(statements[1]).toContain("CREATE TABLE IF NOT EXISTS table_rounds");
    expect(statements[2]).toContain("ALTER TABLE orders ADD COLUMN table_id");
    expect(statements[3]).toContain("ALTER TABLE orders ADD COLUMN round_id");
    // กัน fragment ค้างจากคอมเมนต์บรรทัด 8
    for (const s of statements) {
      expect(s.trim().endsWith("(UNIQUE reservation_id")).toBe(false);
    }
    // naive split(';') เดิมแตกเกินเพราะ `;` ในคอมเมนต์
    expect(sql.split(";").length).toBeGreaterThan(statements.length + 1);
  });

  it("จับ duplicate-column ได้ทั้ง code/errno/message ของ mysql2", () => {
    expect(isDuplicateColumnError({ code: "ER_DUP_FIELDNAME" })).toBe(true);
    expect(isDuplicateColumnError({ errno: 1060 })).toBe(true);
    expect(
      isDuplicateColumnError({
        code: "ER_DUP_FIELDNAME",
        errno: 1060,
        sqlMessage: "Duplicate column name 'password_version'",
      }),
    ).toBe(true);
    expect(isDuplicateColumnError({ message: "Duplicate column name 'password_version'" })).toBe(true);
    expect(isDuplicateColumnError({ sqlMessage: "duplicate COLUMN name 'x'" })).toBe(true);
  });

  it("ไม่กลืน error อื่น (duplicate entry / syntax / null)", () => {
    expect(isDuplicateColumnError({ code: "ER_DUP_ENTRY", errno: 1062 })).toBe(false);
    expect(isDuplicateColumnError({ code: "ER_PARSE_ERROR", message: "syntax error" })).toBe(false);
    expect(isDuplicateColumnError(null)).toBe(false);
    expect(isDuplicateColumnError(undefined)).toBe(false);
    expect(isDuplicateColumnError({})).toBe(false);
  });

  it("ยอมข้ามเฉพาะ ALTER TABLE ADD [COLUMN]", () => {
    expect(isAlterTableAddColumnStatement("ALTER TABLE users ADD COLUMN password_version INT NOT NULL DEFAULT 1")).toBe(
      true,
    );
    expect(isAlterTableAddColumnStatement("alter table orders add table_id CHAR(36) NULL")).toBe(true);
    expect(isAlterTableAddColumnStatement("-- คอมเมนต์นำ\nALTER TABLE orders ADD COLUMN round_id CHAR(36) NULL")).toBe(
      true,
    );
    expect(isAlterTableAddColumnStatement("ALTER TABLE t ADD INDEX idx_a (a)")).toBe(false);
    expect(isAlterTableAddColumnStatement("ALTER TABLE t ADD CONSTRAINT fk_a FOREIGN KEY (a) REFERENCES o(id)")).toBe(
      false,
    );
    expect(isAlterTableAddColumnStatement("CREATE TABLE t (id INT PRIMARY KEY)")).toBe(false);
    expect(isAlterTableAddColumnStatement("ALTER TABLE t DROP COLUMN c")).toBe(false);
  });
});
