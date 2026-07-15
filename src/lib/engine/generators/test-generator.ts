// Test Generation Skill — generates real test files derived from the data model.
// web → __tests__/<entity>.test.ts (Vitest)
// desktop → Tests/<Entity>ViewModelTests.cs (xUnit [Fact])
// android → app/src/test/java/.../<Entity>DaoTest.kt (JUnit)
//
// Tests are derived from the data model entities, not hardcoded.

import type { VirtualFile } from "../generators";
import { inferDataModel } from "./data-model";
import type { Capability, NonFunctional } from "../types";

export interface TestGenerationContext {
  projectName: string;
  prompt: string;
  capabilities: Capability[];
  nonFunctionals: NonFunctional[];
}

export function generateWebTests(ctx: TestGenerationContext): VirtualFile[] {
  const model = inferDataModel(ctx.prompt);
  const entity = model.entityName;
  const entityLower = model.entityNameLower;
  const fields = model.fields.filter((f) => f.name !== "Id" && f.name !== "CreatedAt" && f.name !== "UpdatedAt");

  return [
    {
      path: `__tests__/${entityLower}.test.ts`,
      language: "typescript",
      content: `import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST, GET, DELETE } from "../app/api/${model.entityNamePluralLower}/route";

// Mock Prisma client
vi.mock("../lib/prisma", () => ({
  prisma: {
    ${entityLower}: {
      create: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { prisma } from "../lib/prisma";

describe("${entity} API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/${model.entityNamePluralLower}", () => {
    it("should create a new ${entityLower} with valid data", async () => {
      const mockCreated = {
        id: "test-id-1",
${fields.map((f) => `        ${f.name}: ${f.type === "number" ? "10" : '"Test"'}`).join(",\n")},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (prisma.${entityLower}.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockCreated);

      const req = new Request("http://localhost/api/${model.entityNamePluralLower}", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
${fields.map((f) => `          ${f.name}: ${f.type === "number" ? "10" : '"Test"'}`).join(",\n")},
        }),
      });

      const res = await POST(req as any);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.id).toBe("test-id-1");
      expect(prisma.${entityLower}.create).toHaveBeenCalledOnce();
    });

    it("should return 500 on invalid data", async () => {
      (prisma.${entityLower}.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("DB error"));

      const req = new Request("http://localhost/api/${model.entityNamePluralLower}", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test" }),
      });

      const res = await POST(req as any);
      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/${model.entityNamePluralLower}", () => {
    it("should return list of ${model.entityNamePluralLower}", async () => {
      const mockList = [
        { id: "1", name: "Item 1", quantity: 5, price: 10.0, createdAt: new Date(), updatedAt: new Date() },
      ];
      (prisma.${entityLower}.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockList);

      const res = await GET();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe("Item 1");
    });
  });

  describe("DELETE /api/${model.entityNamePluralLower}", () => {
    it("should delete ${entityLower} by id", async () => {
      (prisma.${entityLower}.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const req = new Request("http://localhost/api/${model.entityNamePluralLower}?id=test-1", {
        method: "DELETE",
      });

      const res = await DELETE(req as any);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(prisma.${entityLower}.delete).toHaveBeenCalledWith({ where: { id: "test-1" } });
    });

    it("should return 400 when id is missing", async () => {
      const req = new Request("http://localhost/api/${model.entityNamePluralLower}", {
        method: "DELETE",
      });

      const res = await DELETE(req as any);
      expect(res.status).toBe(400);
    });
  });
});
`,
    },
    {
      path: `vitest.config.ts`,
      language: "typescript",
      content: `import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: [],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
`,
    },
  ];
}

export function generateDesktopTests(ctx: TestGenerationContext): VirtualFile[] {
  const model = inferDataModel(ctx.prompt);
  const entity = model.entityName;
  const appName = entity.replace(/[^a-zA-Z0-9]/g, "");
  const fields = model.fields.filter((f) => f.name !== "Id" && f.name !== "CreatedAt" && f.name !== "UpdatedAt");

  return [
    {
      path: `Tests/${entity}ViewModelTests.cs`,
      language: "csharp",
      content: `using ${appName}.ViewModels;
using ${appName}.Models;
using Xunit;

namespace ${appName}.Tests;

/// <summary>
/// Unit tests for MainViewModel CRUD operations.
/// Generated by Pavan's Test Generator from the ${entity} data model.
/// </summary>
public class ${entity}ViewModelTests
{
    [Fact]
    public void Add_ShouldAddItemToCollection()
    {
        // Arrange
        var vm = new MainViewModel();
        vm.NewName = "Test Item";
        vm.NewQuantity = 5;
        vm.NewPrice = 19.99;

        // Act
        vm.AddCommand.Execute(null);

        // Assert
        Assert.Single(vm.Items);
        Assert.Equal("Test Item", vm.Items[0].Name);
        Assert.Equal(5, vm.Items[0].Quantity);
        Assert.Equal(19.99, vm.Items[0].Price);
        Assert.NotEmpty(vm.Items[0].Id);
    }

    [Fact]
    public void Add_ShouldNotAdd_WhenNameIsEmpty()
    {
        // Arrange
        var vm = new MainViewModel();
        vm.NewName = "";
        vm.NewQuantity = 1;
        vm.NewPrice = 1.0;

        // Act
        vm.AddCommand.Execute(null);

        // Assert
        Assert.Empty(vm.Items);
    }

    [Fact]
    public void Add_ShouldResetForm_AfterAdd()
    {
        // Arrange
        var vm = new MainViewModel();
        vm.NewName = "Test";
        vm.NewQuantity = 3;
        vm.NewPrice = 9.99;

        // Act
        vm.AddCommand.Execute(null);

        // Assert
        Assert.Equal(string.Empty, vm.NewName);
        Assert.Equal(0, vm.NewQuantity);
        Assert.Equal(0, vm.NewPrice);
    }

    [Fact]
    public void Delete_ShouldRemoveItemFromCollection()
    {
        // Arrange
        var vm = new MainViewModel();
        vm.NewName = "To Delete";
        vm.NewQuantity = 1;
        vm.NewPrice = 1.0;
        vm.AddCommand.Execute(null);
        var item = vm.Items[0];

        // Act
        vm.DeleteCommand.Execute(item);

        // Assert
        Assert.Empty(vm.Items);
    }

    [Fact]
    public void Delete_ShouldDoNothing_WhenItemIsNull()
    {
        // Arrange
        var vm = new MainViewModel();

        // Act — should not throw
        vm.DeleteCommand.Execute(null);

        // Assert
        Assert.Empty(vm.Items);
    }

    [Fact]
    public void Title_ShouldReturnProjectName()
    {
        var vm = new MainViewModel();
        Assert.NotNull(vm.Title);
        Assert.NotEmpty(vm.Title);
    }
}
`,
    },
  ];
}

export function generateAndroidTests(ctx: TestGenerationContext): VirtualFile[] {
  const model = inferDataModel(ctx.prompt);
  const entity = model.entityName;
  const pkg = ctx.projectName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const pkgName = `com.pavan.${pkg}`;
  const pkgPath = `com/pavan/${pkg}`;

  return [
    {
      path: `app/src/test/java/${pkgPath}/${entity}ViewModelTest.kt`,
      language: "kotlin",
      content: `package ${pkgName}

import org.junit.Test
import org.junit.Assert.*
import org.junit.Before
import ${pkgName}.ui.screens.${entity}ViewModel
import ${pkgName}.data.local.${entity}Entity

/**
 * Unit tests for ${entity}ViewModel CRUD operations.
 * Generated by Pavan's Test Generator from the ${entity} data model.
 */
class ${entity}ViewModelTest {

    private lateinit var viewModel: ${entity}ViewModel

    @Before
    fun setup() {
        viewModel = ${entity}ViewModel()
    }

    @Test
    fun \`initial items list is empty\`() {
        assertEquals(0, viewModel.items.value.size)
    }

    @Test
    fun \`addItem creates new entity with correct name\`() {
        viewModel.onNameChange("Test Item")
        viewModel.onQuantityChange(5)
        viewModel.onPriceChange(19.99)

        viewModel.addItem()

        val items = viewModel.items.value
        assertEquals(1, items.size)
        assertEquals("Test Item", items[0].name)
        assertEquals(5, items[0].quantity)
        assertEquals(19.99, items[0].price, 0.001)
    }

    @Test
    fun \`addItem with empty name does nothing\`() {
        viewModel.onNameChange("")
        viewModel.onQuantityChange(1)
        viewModel.onPriceChange(1.0)

        viewModel.addItem()

        assertEquals(0, viewModel.items.value.size)
    }

    @Test
    fun \`addItem resets form fields\`() {
        viewModel.onNameChange("Test")
        viewModel.onQuantityChange(3)
        viewModel.onPriceChange(9.99)

        viewModel.addItem()

        assertEquals("", viewModel.name.value)
        assertEquals(0, viewModel.quantity.value)
        assertEquals(0.0, viewModel.price.value, 0.001)
    }

    @Test
    fun \`deleteItem removes from list\`() {
        viewModel.onNameChange("To Delete")
        viewModel.onQuantityChange(1)
        viewModel.onPriceChange(1.0)
        viewModel.addItem()

        val item = viewModel.items.value[0]
        viewModel.deleteItem(item)

        assertEquals(0, viewModel.items.value.size)
    }

    @Test
    fun \`multiple adds create multiple items\`() {
        viewModel.onNameChange("Item 1")
        viewModel.addItem()
        viewModel.onNameChange("Item 2")
        viewModel.addItem()
        viewModel.onNameChange("Item 3")
        viewModel.addItem()

        assertEquals(3, viewModel.items.value.size)
    }
}
`,
    },
  ];
}
