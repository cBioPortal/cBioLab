"use client";
// One chat message, and the model's markdown rendered as it streams (from Vercel's AI Elements).
// Streamdown closes unterminated markdown mid-stream and sanitizes what it renders, so a model's
// output cannot put live HTML into the page.
import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/cn";

export const Message = ({ className, from, ...props }: HTMLAttributes<HTMLDivElement> & { from: UIMessage["role"] }) => (
  <div className={cn("group flex w-full flex-col gap-2", from === "user" ? "is-user ml-auto max-w-[85%] items-end" : "is-assistant", className)}
    data-role={from} {...props} />
);

export const MessageContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm text-foreground",
    "group-[.is-user]:rounded-lg group-[.is-user]:bg-accent group-[.is-user]:px-2.5 group-[.is-user]:py-1.5", className)} {...props} />
);

export const MessageResponse = memo(({ className, ...props }: ComponentProps<typeof Streamdown>) => (
  <Streamdown className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)} {...props} />
), (prev, next) => prev.children === next.children && prev.isAnimating === next.isAnimating);
MessageResponse.displayName = "MessageResponse";
