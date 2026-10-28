import { describe, expect, it } from "vitest";
import { suggestSQL, type SQLCompletionContext } from "../src/sql-completion";
const context: SQLCompletionContext = {
  tables: [
    {
      name: "data",
      columns: ["id", "customer_name", "order total", "select", 'a"b'],
    },
    { name: 'workspace."orders.parquet"', columns: ["order_id", "amount"] },
    {
      name: 'workspace."nested/customer data.parquet"',
      columns: ["customer_id"],
    },
    { name: 'workspace."odd""file.parquet"' },
  ],
};
const hint = (sql: string, ctx = context) => suggestSQL(sql, sql.length, ctx);
describe("local SQL suffix suggestions", () => {
  it("completes keywords using the typed case without changing existing text", () => {
    expect(hint("sel")).toBe("ect");
    expect(hint("SEL")).toBe("ECT");
    expect(hint("select * fro")).toBe("m");
    expect(hint("SELECT * FRO")).toBe("M");
    expect(hint("select * from data order ")).toBe("by");
    expect(hint("select * from data GROUP B")).toBe("Y");
    expect(hint("select co")).toBe("unt");
  });
  it("suggests active and workspace tables without changing quoted paths", () => {
    expect(hint("select * from ")).toBe("data");
    expect(hint("select * from da")).toBe("ta");
    expect(hint('SELECT * FROM WORKSPACE."ord')).toBe('ers.parquet"');
    expect(hint('SELECT * FROM workspace."ORD')).toBe("");
    expect(hint('SELECT * FROM workspace."ord')).toBe('ers.parquet"');
    expect(hint('SELECT * FROM workspace."nested/c')).toBe(
      'ustomer data.parquet"',
    );
    expect(hint('SELECT * FROM workspace."odd""')).toBe('file.parquet"');
    expect(hint("SELECT * FROM data JOIN work")).toBe('space."orders.parquet"');
  });
  it("uses only the metadata supplied for this workspace", () => {
    const only: SQLCompletionContext = {
      tables: [{ name: 'workspace."other.parquet"' }],
    };
    expect(hint("SELECT * FROM ", only)).toBe('workspace."other.parquet"');
    expect(hint("SELECT * FROM da", only)).toBe("");
    expect(hint('SELECT * FROM workspace."ord', only)).toBe("");
  });
  it("quotes special column names and supports qualified aliases", () => {
    expect(hint("select customer_")).toBe("name");
    expect(hint('SELECT "order')).toBe(' total"');
    expect(hint('SELECT "a""')).toBe('b"');
    expect(
      hint('SELECT * FROM workspace."orders.parquet" AS o WHERE o.am'),
    ).toBe("ount");
    expect(hint('SELECT * FROM workspace."orders.parquet" o WHERE o.')).toBe(
      "order_id",
    );
    expect(
      hint('SELECT * FROM workspace."orders.parquet" WHERE customer_'),
    ).toBe("");
    expect(hint("SELECT * FROM data WHERE unknown.")).toBe("");
  });
  it("uses later FROM references for a caret at a preceding line end", () => {
    const sql = 'SELECT o.am\nFROM workspace."orders.parquet" o';
    expect(suggestSQL(sql, sql.indexOf("\n"), context)).toBe("ount");
  });
  it.each([
    "SELECT 'fro",
    "SELECT 'it''s fro",
    "SELECT E'it\\'s fro",
    "SELECT $$fro",
    "SELECT $body$fro",
    "SELECT -- fro",
    "SELECT /* fro",
    "SELECT /* outer /* inner */ fro",
  ])("stays silent inside literals/comments: %s", (sql) =>
    expect(hint(sql)).toBe(""),
  );
  it("resumes after comments and complete literals without using their content", () => {
    expect(hint("SELECT /* FROM secret */ customer_")).toBe("name");
    expect(hint("SELECT -- ignored\ncustomer_")).toBe("name");
    expect(hint("SELECT 'FROM secrets' fro")).toBe("m");
    expect(hint("SELECT $$FROM secrets$$ fro")).toBe("m");
    expect(hint('SELECT "FROM" fro')).toBe("m");
  });
  it("does not overlap existing text, repeat exact matches or invent numeric input", () => {
    expect(suggestSQL("select * from data", 12, context)).toBe("");
    expect(hint("SELECT * FROM data")).toBe("");
    expect(hint("SELECT 12")).toBe("");
    expect(hint("")).toBe("");
    expect(hint("unknown")).toBe("");
    expect(suggestSQL("select", -1, context)).toBe("");
    expect(suggestSQL("select", 99, context)).toBe("");
    expect(hint("SELECT 'done'")).toBe("");
  });
  it("handles empty fragments and incomplete metadata conservatively", () => {
    expect(hint("SELECT ")).toBe("*");
    expect(hint("SELECT * FROM data WHERE ")).toBe("id");
    expect(hint("SELECT * FROM data ")).toBe("");
    expect(hint("SELECT * FROM data GROUP BY ")).toBe("id");
    expect(hint("SELECT * FROM data ORDER b")).toBe("y");
    expect(hint("SELECT .")).toBe("");
    expect(hint("SELECT co", { tables: [{ name: "data" }] })).toBe("unt");
  });
  it("does not carry table/alias context across statements", () => {
    expect(hint('SELECT * FROM workspace."orders.parquet" o; sel')).toBe("ect");
    expect(
      hint('SELECT * FROM workspace."orders.parquet" o; SELECT o.am'),
    ).toBe("");
  });
});
