"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Plus, Trash2, Key, ChevronDown, ChevronRight } from "lucide-react"

export interface EnvVarEntry {
  key: string
  value: string
}

interface EnvVarEditorProps {
  value: EnvVarEntry[]
  onChange: (entries: EnvVarEntry[]) => void
  collapsible?: boolean
  label?: string
}

export function EnvVarEditor({
  value,
  onChange,
  collapsible = false,
  label = "Environment Variables",
}: EnvVarEditorProps) {
  const [isExpanded, setIsExpanded] = useState(!collapsible)

  const nonEmptyCount = value.filter((e) => e.key.trim()).length

  const handleKeyChange = (index: number, newKey: string) => {
    onChange(
      value.map((entry, i) =>
        i === index ? { ...entry, key: newKey.toUpperCase() } : entry
      )
    )
  }

  const handleValueChange = (index: number, newValue: string) => {
    onChange(
      value.map((entry, i) =>
        i === index ? { ...entry, value: newValue } : entry
      )
    )
  }

  const handleRemove = (index: number) => {
    const newEntries = value.filter((_, i) => i !== index)
    if (newEntries.length === 0) {
      onChange([{ key: "", value: "" }])
    } else {
      onChange(newEntries)
    }
  }

  const handleAdd = () => {
    onChange([...value, { key: "", value: "" }])
  }

  const header = (
    <div
      className={`flex items-center gap-2 ${collapsible ? "cursor-pointer select-none" : ""}`}
      onClick={collapsible ? () => setIsExpanded(!isExpanded) : undefined}
    >
      {collapsible &&
        (isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        ))}
      <Key className="h-4 w-4 text-muted-foreground" />
      <Label className={`text-sm font-medium ${collapsible ? "cursor-pointer" : ""}`}>
        {label}
      </Label>
      {nonEmptyCount > 0 && (
        <span className="text-xs text-muted-foreground">
          ({nonEmptyCount})
        </span>
      )}
    </div>
  )

  if (collapsible && !isExpanded) {
    return <div className="space-y-2">{header}</div>
  }

  return (
    <div className="space-y-3">
      {header}
      <div className="space-y-2">
        {value.map((entry, index) => (
          <div key={index} className="flex gap-2 items-center">
            <Input
              placeholder="KEY"
              value={entry.key}
              onChange={(e) => handleKeyChange(index, e.target.value)}
              className="font-mono flex-1 h-8 text-sm"
            />
            <Input
              placeholder="value"
              value={entry.value}
              onChange={(e) => handleValueChange(index, e.target.value)}
              className="font-mono flex-[2] h-8 text-sm"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-red-500 shrink-0"
              onClick={() => handleRemove(index)}
              type="button"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={handleAdd}
        type="button"
      >
        <Plus className="h-3 w-3 mr-1" />
        Add Variable
      </Button>
      <p className="text-xs text-muted-foreground">
        Variables are injected at deploy time. Redeploy to apply changes.
      </p>
    </div>
  )
}
