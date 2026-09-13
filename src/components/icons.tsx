import { cn } from '@/lib/utils';
import Image from "next/image"

export const Logo = ({
  className,
  showText = true,
}: {
  className?: string
  showText?: boolean
}) => {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Image
        src="/android-chrome-192x192.png"
        alt="NIS CRM Logo"
        width={36}
        height={36}
        className="h-9 w-9 object-contain shrink-0"
        priority
      />

      {showText && (
        <div className="flex flex-col leading-tight text-start">
          <span className="text-[16px] font-bold text-[#0F172A]">
            NIS CRM
          </span>
          <span className="mt-0.5 text-[13px] font-medium text-[#64748B]">
            Parent Care CRM
          </span>
        </div>
      )}
    </div>
  )
}
