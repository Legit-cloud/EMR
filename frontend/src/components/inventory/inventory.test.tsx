import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InventoryPage from "@/app/(app)/inventory/page";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { afterMovement, checkUnits, levelOf } from "@/lib/inventory";
import { createQueryClient } from "@/lib/query";
import { SessionContext } from "@/lib/session";
import { MOCK_USERS, resetAuthMocks } from "@/mocks/auth";
import { inventoryHandlers, resetInventoryMocks } from "@/mocks/inventory";
import { server } from "@/mocks/server";

vi.setConfig({ testTimeout: 90_000 });

function renderPage(who = "bisi.finance") {
    resetAuthMocks(who);
    server.use(...inventoryHandlers);
    const client = createQueryClient(vi.fn());
    client.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
    return render(
        <ToastProvider>
            <QueryClientProvider client={client}>
                <TooltipProvider>
                    <SessionContext.Provider value={MOCK_USERS[who]}>
                        <InventoryPage />
                    </SessionContext.Provider>
                </TooltipProvider>
            </QueryClientProvider>
        </ToastProvider>,
    );
}

beforeEach(resetInventoryMocks);

describe("supply rules", () => {
    it("names the level of stock", () => {
        expect(levelOf({ on_hand: 0, reorder_level: 5 })).toBe("out");
        expect(levelOf({ on_hand: 5, reorder_level: 5 })).toBe("low");
        expect(levelOf({ on_hand: 6, reorder_level: 5 })).toBe("ok");
    });

    it("checks whole numbers and previews the count after a movement", () => {
        expect(checkUnits("12")).toEqual({ units: 12 });
        expect(checkUnits("0")).toHaveProperty("error");
        expect(checkUnits("0", { min: 0 })).toEqual({ units: 0 });
        expect(checkUnits("1.5")).toHaveProperty("error");
        expect(afterMovement("receive", 4, 6)).toBe(10);
        expect(afterMovement("issue", 4, 6)).toBe(-2);
        expect(afterMovement("adjust", 4, 9)).toBe(9);
    });
});

describe("supplies screen", () => {
    it("shows totals and the list with stock levels", async () => {
        renderPage();
        const table = await screen.findByRole("table", { name: "Supplies" });
        expect(await within(table).findByText("Gloves, medium")).toBeInTheDocument();
        expect(within(table).getByText("Out of stock")).toBeInTheDocument();
        expect(within(table).getByText("Low")).toBeInTheDocument();
        expect(screen.getByText("Stock value")).toBeInTheDocument();
    });

    it("filters to low stock and by search", async () => {
        renderPage();
        const table = await screen.findByRole("table", { name: "Supplies" });
        await within(table).findByText("Gloves, medium");
        await userEvent.click(screen.getByLabelText("Low or out of stock only"));
        await waitFor(() => expect(within(table).queryByText("Gloves, medium")).toBeNull());
        expect(within(table).getByText("Syringes 5 ml")).toBeInTheDocument();
    });

    it("lets the tenant admin add supplies but not move stock", async () => {
        renderPage();
        await screen.findByRole("table", { name: "Supplies" });
        expect(screen.getByRole("button", { name: "Add supply" })).toBeInTheDocument();
        await screen.findByText("Gloves, medium");
        expect(screen.queryByRole("button", { name: /Actions for/ })).toBeNull();
    });
});
