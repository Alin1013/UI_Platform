/**
 * 报告状态筛选下拉框。
 * 自定义展开层用于统一面板视觉；交互仍按 listbox 模式支持键盘和读屏。
 */

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type ReportStatusFilter = "all" | "succeeded" | "failed";

const statusOptions: Array<{
  value: ReportStatusFilter;
  label: string;
}> = [
  { value: "all", label: "全部状态" },
  { value: "succeeded", label: "已通过" },
  { value: "failed", label: "失败" },
];

export function StatusFilterSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ReportStatusFilter;
  onChange: (value: ReportStatusFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();
  const selectedOption =
    statusOptions.find((option) => option.value === value) ?? statusOptions[0];

  useEffect(() => {
    if (!open) return;

    // 点击外部和 Escape 是关闭层的两条独立路径；Escape 还要把焦点还给触发器。
    function handlePointerDown(event: PointerEvent) {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // 展开后焦点进入选中项，方向键从当前语义位置开始，而不是每次都跳到第一项。
    listboxRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.focus();
  }, [open]);

  function commit(nextValue: ReportStatusFilter) {
    onChange(nextValue);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveOptionFocus(currentIndex: number, offset: number) {
    const nextIndex = Math.min(
      statusOptions.length - 1,
      Math.max(0, currentIndex + offset),
    );
    listboxRef.current
      ?.querySelectorAll<HTMLElement>("[role='option']")
      [nextIndex]?.focus();
  }

  return (
    <div
      ref={rootRef}
      className="select-field"
      onBlur={(event) => {
        // Tab 离开整个控件时收起菜单；relatedTarget 为空也视为焦点已离开文档。
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="select-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          // 方向键不触发页面滚动，而是和常见 combobox 一样打开列表。
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{selectedOption.label}</span>
        <ChevronDown
          className={open ? "select-chevron select-chevron-open" : "select-chevron"}
          size={16}
          aria-hidden
        />
      </button>

      {open ? (
        <ul
          ref={listboxRef}
          id={listboxId}
          className="select-menu"
          role="listbox"
          aria-label={label}
          tabIndex={-1}
        >
          {statusOptions.map((option, index) => (
            <li key={option.value} role="presentation">
              <button
                type="button"
                role="option"
                className="select-option"
                aria-selected={option.value === value}
                tabIndex={option.value === value ? 0 : -1}
                onClick={() => commit(option.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveOptionFocus(index, 1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveOptionFocus(index, -1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    moveOptionFocus(index, -index);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    moveOptionFocus(index, statusOptions.length - 1 - index);
                  }
                }}
              >
                <span>{option.label}</span>
                <span className="select-check" aria-hidden>
                  {option.value === value ? <Check size={15} /> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
