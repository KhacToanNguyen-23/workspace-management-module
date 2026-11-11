package org.hyperdatalab.wbmodule.directory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.interfaces.RSAPrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * Google Admin SDK Directory API (users.get / users.list) through a service account with
 * domain-wide delegation, acting as the domain admin. Only reads user accounts of the domain.
 */
public class GoogleUserDirectory implements UserDirectory {
    private static final String SCOPE =
            "https://www.googleapis.com/auth/admin.directory.user.readonly";
    private static final String TOKEN_URL = "https://oauth2.googleapis.com/token";
    private static final String API = "https://admin.googleapis.com/admin/directory/v1";

    private final HttpClient http =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ObjectMapper json;
    private final String clientEmail;
    private final RSAPrivateKey key;
    private final String adminEmail;
    private final String domain;
    private String accessToken;
    private Instant accessTokenExpiry = Instant.EPOCH;

    public GoogleUserDirectory(
            ObjectMapper json, String serviceAccountFile, String adminEmail, String domain) {
        this.json = json;
        this.adminEmail = adminEmail;
        this.domain = domain;
        try {
            JsonNode sa = json.readTree(Files.readString(Path.of(serviceAccountFile)));
            this.clientEmail = sa.path("client_email").asText();
            String pem =
                    sa.path("private_key")
                            .asText()
                            .replace("-----BEGIN PRIVATE KEY-----", "")
                            .replace("-----END PRIVATE KEY-----", "")
                            .replaceAll("\\s", "");
            this.key =
                    (RSAPrivateKey)
                            KeyFactory.getInstance("RSA")
                                    .generatePrivate(
                                            new PKCS8EncodedKeySpec(
                                                    Base64.getDecoder().decode(pem)));
        } catch (Exception e) {
            throw new IllegalStateException(
                    "Cannot read the Google service account file: " + e.getMessage(), e);
        }
    }

    @Override
    public String mode() {
        return "google";
    }

    private synchronized String token() {
        if (accessToken != null && Instant.now().isBefore(accessTokenExpiry.minusSeconds(60)))
            return accessToken;
        try {
            Instant now = Instant.now();
            SignedJWT jwt =
                    new SignedJWT(
                            new JWSHeader.Builder(JWSAlgorithm.RS256)
                                    .type(JOSEObjectType.JWT)
                                    .build(),
                            new JWTClaimsSet.Builder()
                                    .issuer(clientEmail)
                                    .subject(adminEmail)
                                    .audience(TOKEN_URL)
                                    .claim("scope", SCOPE)
                                    .issueTime(Date.from(now))
                                    .expirationTime(Date.from(now.plusSeconds(3600)))
                                    .build());
            jwt.sign(new RSASSASigner(key));
            String form =
                    "grant_type="
                            + URLEncoder.encode(
                                    "urn:ietf:params:oauth:grant-type:jwt-bearer",
                                    StandardCharsets.UTF_8)
                            + "&assertion="
                            + jwt.serialize();
            HttpResponse<String> res =
                    http.send(
                            HttpRequest.newBuilder(URI.create(TOKEN_URL))
                                    .header("content-type", "application/x-www-form-urlencoded")
                                    .POST(HttpRequest.BodyPublishers.ofString(form))
                                    .build(),
                            HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200)
                throw new DirectoryException(
                        "Google token exchange failed (" + res.statusCode() + ").");
            JsonNode body = json.readTree(res.body());
            accessToken = body.path("access_token").asText();
            accessTokenExpiry = now.plusSeconds(body.path("expires_in").asLong(3600));
            return accessToken;
        } catch (DirectoryException e) {
            throw e;
        } catch (Exception e) {
            throw new DirectoryException("Google token exchange failed: " + e.getMessage());
        }
    }

    private HttpResponse<String> get(String url) {
        try {
            return http.send(
                    HttpRequest.newBuilder(URI.create(url))
                            .header("authorization", "Bearer " + token())
                            .GET()
                            .build(),
                    HttpResponse.BodyHandlers.ofString());
        } catch (DirectoryException e) {
            throw e;
        } catch (Exception e) {
            throw new DirectoryException("Google Directory is unreachable: " + e.getMessage());
        }
    }

    static DirectoryUser map(JsonNode u) {
        return new DirectoryUser(
                u.path("primaryEmail").asText().toLowerCase(Locale.ROOT),
                u.path("name").path("fullName").asText(""),
                u.hasNonNull("thumbnailPhotoUrl") ? u.get("thumbnailPhotoUrl").asText() : null,
                u.hasNonNull("orgUnitPath") ? u.get("orgUnitPath").asText() : null,
                u.path("suspended").asBoolean(false) || u.path("archived").asBoolean(false));
    }

    @Override
    public Optional<DirectoryUser> find(String email) {
        HttpResponse<String> res =
                get(
                        API
                                + "/users/"
                                + URLEncoder.encode(email, StandardCharsets.UTF_8)
                                + "?projection=basic");
        if (res.statusCode() == 404) return Optional.empty();
        if (res.statusCode() != 200)
            throw new DirectoryException("Directory lookup failed (" + res.statusCode() + ").");
        try {
            return Optional.of(map(json.readTree(res.body())));
        } catch (Exception e) {
            throw new DirectoryException("Directory returned invalid JSON.");
        }
    }

    @Override
    public List<DirectoryUser> listAll() {
        List<DirectoryUser> out = new ArrayList<>();
        String pageToken = null;
        do {
            String url =
                    API
                            + "/users?projection=basic&maxResults=500&domain="
                            + URLEncoder.encode(domain, StandardCharsets.UTF_8)
                            + (pageToken != null
                                    ? "&pageToken="
                                            + URLEncoder.encode(pageToken, StandardCharsets.UTF_8)
                                    : "");
            HttpResponse<String> res = get(url);
            if (res.statusCode() != 200)
                throw new DirectoryException("Directory list failed (" + res.statusCode() + ").");
            try {
                JsonNode body = json.readTree(res.body());
                body.path("users").forEach(u -> out.add(map(u)));
                pageToken =
                        body.hasNonNull("nextPageToken")
                                ? body.get("nextPageToken").asText()
                                : null;
            } catch (Exception e) {
                throw new DirectoryException("Directory returned invalid JSON.");
            }
        } while (pageToken != null);
        return out;
    }
}
