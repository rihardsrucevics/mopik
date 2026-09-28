import { ProductRoute, type SearchParams } from "@/components/product/product-route";
import { productMetadata } from "@/lib/product/metadata";

/** The product page in its own language — see `lib/product/routes.ts`. */
export const metadata = productMetadata("et");

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <ProductRoute locale="et" searchParams={searchParams} />;
}
