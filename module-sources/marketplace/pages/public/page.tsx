/**
 * The marketplace, written by the server.
 *
 * The board below stays a client component - listing something and buying
 * something are its job - but the listings used to be fetched on mount, so the
 * HTML the server sent carried no listing, no title and no price: measured, 91
 * characters of text inside `<main>`.
 */
import { readListings } from "../../lib/read-listings";
import { ListingBoard } from "../../components/ListingBoard";

export default async function MarketplacePage() {
    const read = await readListings(1);
    return <ListingBoard initial={read.listings} />;
}
