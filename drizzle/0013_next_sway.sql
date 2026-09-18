DROP INDEX "uq_push_sub_tenant_endpoint";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_push_sub_tenant_user_endpoint" ON "push_subscription" USING btree ("tenant_id","user_id","endpoint");