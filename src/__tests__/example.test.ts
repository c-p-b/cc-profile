describe("Example Test Suite", () => {
  it("should pass a basic test", () => {
    expect(1 + 1).toBe(2);
  });

  it("should handle async operations", async () => {
    const promise = Promise.resolve("test");
    const result = await promise;
    expect(result).toBe("test");
  });
});
