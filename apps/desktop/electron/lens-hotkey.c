#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <stdio.h>
#include <stdlib.h>

/*
 * A tiny listen-only event tap. Electron's globalShortcut intentionally
 * exposes a press callback, but a Clicky-style Lens gesture needs the exact
 * key-up edge as well. This helper never suppresses or modifies input; it
 * reports only Option+Space transitions to the trusted Electron process.
 */
static int down = 0;

static void emit_event(const char *name) {
  fputs(name, stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

static CGEventRef callback(CGEventTapProxy proxy, CGEventType type,
                           CGEventRef event, void *refcon) {
  (void)proxy;
  (void)refcon;
  if (type == kCGEventTapDisabledByTimeout ||
      type == kCGEventTapDisabledByUserInput) {
    emit_event("error:event-tap-disabled");
    return event;
  }
  if (type != kCGEventKeyDown && type != kCGEventKeyUp) return event;

  CGKeyCode key = (CGKeyCode)CGEventGetIntegerValueField(
      event, kCGKeyboardEventKeycode);
  CGEventFlags flags = CGEventGetFlags(event);
  int option = (flags & kCGEventFlagMaskAlternate) != 0;
  if (key != 49 || !option) return event;

  if (type == kCGEventKeyDown) {
    int repeat = (int)CGEventGetIntegerValueField(
        event, kCGKeyboardEventAutorepeat);
    if (!repeat && !down) {
      down = 1;
      emit_event("down");
    }
  } else if (down) {
    down = 0;
    emit_event("up");
  }
  return event;
}

int main(void) {
  CGEventMask mask = CGEventMaskBit(kCGEventKeyDown) |
                     CGEventMaskBit(kCGEventKeyUp);
  CFMachPortRef tap = CGEventTapCreate(
      kCGSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionListenOnly,
      mask, callback, NULL);
  if (!tap) {
    emit_event("error:input-monitoring");
    return 2;
  }
  CFRunLoopSourceRef source = CFMachPortCreateRunLoopSource(NULL, tap, 0);
  if (!source) {
    emit_event("error:run-loop");
    CFRelease(tap);
    return 3;
  }
  CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
  emit_event("ready");
  CFRunLoopRun();
  CFRelease(source);
  CFRelease(tap);
  return 0;
}
