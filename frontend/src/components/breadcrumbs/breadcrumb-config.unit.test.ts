import { describe, expect, it } from "vitest";
import { buildCrumbChain } from "./breadcrumb-config";

describe("buildCrumbChain", () => {
  describe("/student/:id/syllabi/:syllabusId, role coach", () => {
    const chain = buildCrumbChain("/student/4/syllabi/2", "coach");

    it("returns four crumbs", () => {
      expect(chain).toHaveLength(4);
    });

    it("has the correct patterns in root-first order", () => {
      expect(chain.map((c) => c.pattern)).toEqual([
        "/students",
        "/student/:id",
        "/student/:id/syllabi",
        "/student/:id/syllabi/:syllabusId",
      ]);
    });

    it("has the correct to paths", () => {
      expect(chain.map((c) => c.to)).toEqual([
        "/students",
        "/student/4",
        "/student/4/syllabi",
        "/student/4/syllabi/2",
      ]);
    });

    it("carries params on each crumb", () => {
      for (const crumb of chain) {
        expect(crumb.params).toMatchObject({ id: "4", syllabusId: "2" });
      }
    });

    it("marks /students as staticLabel", () => {
      expect(chain[0].staticLabel).toBe("Students");
      expect(chain[0].dynamic).toBeUndefined();
    });

    it("marks /student/:id as dynamic studentName", () => {
      expect(chain[1].dynamic).toBe("studentName");
      expect(chain[1].staticLabel).toBeUndefined();
    });

    it("marks /student/:id/syllabi as staticLabel", () => {
      expect(chain[2].staticLabel).toBe("Syllabi");
      expect(chain[2].dynamic).toBeUndefined();
    });

    it("marks /student/:id/syllabi/:syllabusId as dynamic studentSyllabusName", () => {
      expect(chain[3].dynamic).toBe("studentSyllabusName");
      expect(chain[3].staticLabel).toBeUndefined();
    });
  });

  describe("/student/:id/syllabi/:syllabusId, role student", () => {
    const chain = buildCrumbChain("/student/4/syllabi/2", "student");

    it("drops the /students crumb", () => {
      expect(chain.find((c) => c.pattern === "/students")).toBeUndefined();
    });

    it("returns three crumbs starting at /student/:id", () => {
      expect(chain).toHaveLength(3);
      expect(chain[0].pattern).toBe("/student/:id");
    });
  });

  describe("/library", () => {
    const chain = buildCrumbChain("/library", "coach");

    it("returns a single crumb", () => {
      expect(chain).toHaveLength(1);
    });

    it("has the correct shape", () => {
      expect(chain[0]).toMatchObject({
        pattern: "/library",
        staticLabel: "Library",
        to: "/library",
      });
    });
  });

  describe("/student/:id/pinned, role coach", () => {
    const chain = buildCrumbChain("/student/4/pinned", "coach");

    it("returns three crumbs", () => {
      expect(chain).toHaveLength(3);
    });

    it("has the correct patterns", () => {
      expect(chain.map((c) => c.pattern)).toEqual([
        "/students",
        "/student/:id",
        "/student/:id/pinned",
      ]);
    });

    it("has the correct to paths", () => {
      expect(chain.map((c) => c.to)).toEqual([
        "/students",
        "/student/4",
        "/student/4/pinned",
      ]);
    });
  });

  describe("unmatched path", () => {
    it("returns [] for /login", () => {
      expect(buildCrumbChain("/login", "coach")).toEqual([]);
    });

    it("returns [] for /unknown/path", () => {
      expect(buildCrumbChain("/unknown/path", "student")).toEqual([]);
    });
  });
});
