package org.hyperdatalab.wbmodule.config;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.cloud.firestore.Firestore;
import com.google.cloud.firestore.FirestoreOptions;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.FileInputStream;
import java.io.IOException;

@Configuration
public class FirestoreConfig {
    @Bean(destroyMethod = "close")
    Firestore firestore(
            @Value("${app.firestore.project-id}") String projectId,
            @Value("${app.firestore.emulator-host:}") String emulatorHost,
            @Value("${app.firestore.credentials-file:}") String credentialsFile)
            throws IOException {
        FirestoreOptions.Builder builder = FirestoreOptions.newBuilder().setProjectId(projectId);
        if (emulatorHost != null && !emulatorHost.isBlank()) {
            builder.setEmulatorHost(emulatorHost);
        } else if (credentialsFile != null && !credentialsFile.isBlank()) {
            builder.setCredentials(
                    GoogleCredentials.fromStream(new FileInputStream(credentialsFile)));
        } else {
            builder.setCredentials(GoogleCredentials.getApplicationDefault());
        }
        return builder.build().getService();
    }
}
