package org.hyperdatalab.wbmodule.common;

import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.util.ArrayList;
import java.util.List;

/**
 * Offset pagination for collection resources. The body stays a plain JSON array; the total and the
 * neighbouring pages travel in headers ({@code X-Total-Count}, {@code Link} with rel next/prev).
 */
public final class Paging {
    public static final int DEFAULT_LIMIT = 100;
    public static final int MAX_LIMIT = 500;

    private Paging() {}

    public static <T> ResponseEntity<List<T>> page(List<T> all, Integer limit, Integer offset) {
        int size = limit == null ? DEFAULT_LIMIT : limit;
        int from = offset == null ? 0 : offset;
        if (size < 1 || size > MAX_LIMIT)
            throw ApiException.unprocessable(
                    "validation", "limit must be between 1 and " + MAX_LIMIT + ".");
        if (from < 0) throw ApiException.unprocessable("validation", "offset must not be negative.");

        int total = all.size();
        List<T> slice = from >= total ? List.of() : all.subList(from, Math.min(total, from + size));

        HttpHeaders headers = new HttpHeaders();
        headers.add("X-Total-Count", String.valueOf(total));
        List<String> links = new ArrayList<>();
        if (from + size < total) links.add(link(size, from + size, "next"));
        if (from > 0) links.add(link(size, Math.max(0, from - size), "prev"));
        if (!links.isEmpty()) headers.add(HttpHeaders.LINK, String.join(", ", links));
        return ResponseEntity.ok().headers(headers).body(slice);
    }

    private static String link(int limit, int offset, String rel) {
        String url =
                ServletUriComponentsBuilder.fromCurrentRequest()
                        .replaceQueryParam("limit", limit)
                        .replaceQueryParam("offset", offset)
                        .build()
                        .toUriString();
        return "<" + url + ">; rel=\"" + rel + "\"";
    }
}
