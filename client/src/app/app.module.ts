import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';

import { AppComponent } from './app.component';
import { StoresComponent } from './stores/stores.component';
import {StoresService} from './stores.service';
import {HttpModule} from '@angular/http';

@NgModule({
  declarations: [
    AppComponent,
    StoresComponent
  ],
  imports: [
    BrowserModule, HttpModule,
  ],
  providers: [StoresService],
  bootstrap: [AppComponent]
})
export class AppModule { }
