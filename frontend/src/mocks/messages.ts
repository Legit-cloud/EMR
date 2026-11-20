import { http, HttpResponse } from "msw";

import type { Schemas } from "@/lib/api";

/** Staff threads, shaped like apps/messaging (docs/adr/0026). Synthetic data. */
type Detail = Schemas["ThreadDetail"];
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const ME = "Ada Tester";

function seeded(): Mutable<Detail>[] {
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return [
    {
      id: "thread-1",
      subject: "Bed 4 linen",
      updated_at: at(10),
      last_body: "Please send clean linen.",
      unread: 1,
      members: [ME, "Chidi Eze"],
      messages: [
        {
          id: "m1",
          sender: "user-chidi",
          sender_name: "Chidi Eze",
          body: "Please send clean linen.",
          created_at: at(10),
        },
      ],
    },
  ];
}

export let threads = seeded();
export const resetMessageMocks = () => {
  threads = seeded();
};

/** The people the recipient picker offers. Not in the global handlers: the staff mock owns that URL. */
export const messagePeopleHandler = http.get("*/api/staff/profiles/", () =>
  HttpResponse.json({
    count: 2,
    next: null,
    previous: null,
    results: [
      { id: "p1", user: "user-chidi", display_name: "Chidi Eze" },
      { id: "p2", user: "user-bola", display_name: "Bola Adeyemi" },
    ],
  }),
);

export const messageHandlers = [
  http.get("*/api/messaging/threads/", () =>
    HttpResponse.json({
      count: threads.length,
      next: null,
      previous: null,
      results: threads.map(({ messages: _messages, ...thread }) => thread),
    }),
  ),
  http.get("*/api/messaging/threads/:id/", ({ params }) => {
    const thread = threads.find((t) => t.id === params.id);
    if (!thread) return HttpResponse.json({}, { status: 404 });
    thread.unread = 0;
    return HttpResponse.json(thread);
  }),
  http.post("*/api/messaging/threads/", async ({ request }) => {
    const body = (await request.json()) as Schemas["NewThreadRequest"];
    const now = new Date().toISOString();
    const thread: Mutable<Detail> = {
      id: `thread-${threads.length + 1}`,
      subject: body.subject,
      updated_at: now,
      last_body: body.body,
      unread: 0,
      members: [ME, ...body.recipients],
      messages: [{ id: "mx", sender: "me", sender_name: ME, body: body.body, created_at: now }],
    };
    threads.unshift(thread);
    return HttpResponse.json(thread, { status: 201 });
  }),
  http.post("*/api/messaging/threads/:id/reply/", async ({ params, request }) => {
    const body = (await request.json()) as Schemas["ReplyRequest"];
    const thread = threads.find((t) => t.id === params.id);
    if (!thread) return HttpResponse.json({}, { status: 404 });
    const message = {
      id: `m${thread.messages.length + 1}`,
      sender: "me",
      sender_name: ME,
      body: body.body,
      created_at: new Date().toISOString(),
    };
    thread.messages.push(message);
    thread.last_body = body.body;
    return HttpResponse.json(message, { status: 201 });
  }),
];
