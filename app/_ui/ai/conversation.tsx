"use client";
// A chat transcript that keeps to its newest message while it streams, unless the reader has
// scrolled up (from Vercel's AI Elements).
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/app/_ui/button";
import { cn } from "@/lib/cn";

export const Conversation = ({ className, ...props }: ComponentProps<typeof StickToBottom>) => (
  <StickToBottom className={cn("relative flex-1 overflow-y-hidden", className)} initial="smooth" resize="smooth" role="log" {...props} />
);

export const ConversationContent = ({ className, ...props }: ComponentProps<typeof StickToBottom.Content>) => (
  <StickToBottom.Content className={cn("flex flex-col gap-4 p-4", className)} {...props} />
);

export const ConversationScrollButton = ({ className, ...props }: ComponentProps<typeof Button>) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  return !isAtBottom && (
    <Button className={cn("absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full", className)}
      onClick={() => scrollToBottom()} size="icon-sm" type="button" variant="outline" aria-label="Scroll to the newest message" {...props}>
      <ArrowDownIcon className="size-4" />
    </Button>
  );
};
