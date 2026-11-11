package org.hyperdatalab.wbmodule.auth;

import org.hyperdatalab.wbmodule.common.AppProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.MethodParameter;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.List;

@Configuration
public class WebConfig implements WebMvcConfigurer {
    private final AppProperties props;

    public WebConfig(AppProperties props) {
        this.props = props;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(props.corsOrigins().toArray(String[]::new))
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("authorization", "content-type")
                .exposedHeaders("WWW-Authenticate")
                .maxAge(600);
    }

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(
                new HandlerMethodArgumentResolver() {
                    @Override
                    public boolean supportsParameter(MethodParameter p) {
                        return p.getParameterType() == AuthedUser.class;
                    }

                    @Override
                    public Object resolveArgument(
                            MethodParameter p,
                            ModelAndViewContainer m,
                            NativeWebRequest req,
                            WebDataBinderFactory f) {
                        Object user =
                                req.getAttribute(
                                        AuthedUser.ATTRIBUTE, RequestAttributes.SCOPE_REQUEST);
                        if (user == null)
                            throw new IllegalStateException(
                                    "AuthFilter did not run for this route");
                        return user;
                    }
                });
    }
}
