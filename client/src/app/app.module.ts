import {BrowserModule} from '@angular/platform-browser';
import {NgModule} from '@angular/core';

import {AppComponent} from './app.component';
import {StoresComponent} from './stores/stores.component';
import {StoresService1} from './stores.service';
import {HttpModule} from '@angular/http';
import {CircuitComponent} from './circuit/circuit.component';
import {StaticCircuitDesignerComponent} from './static-circuit-designer/static-circuit-designer.component';
import {CircuitsService} from './circuits.service';
import {StaticCircuitChallangerComponent} from './static-circuit-challanger/static-circuit-challanger.component';
import {RouterModule, Routes} from '@angular/router';
import {GuidedCircuitDesignerComponent} from './guided-circuit-designer/guided-circuit-designer.component';
import {GuidedCircuitChallengerComponent} from './guided-circuit-challenger/guided-circuit-challenger.component';
import {AuthComponent} from './auth/auth.component';
import {CallbackComponent} from './callback/callback.component';
import {AuthService} from './auth.service';

const route: Routes = [
  {path: 'callback', component: CallbackComponent},
  {
    path: 'auth',
    component: AuthComponent
  }
  ,
  {
    path: 'designer/:id',
    component: StaticCircuitDesignerComponent
  }
  ,
  {
    path: 'challanger/:id',
    component: StaticCircuitChallangerComponent
  },
  {
    path: 'challanger1/:id',
    component: GuidedCircuitChallengerComponent
  }
  , {
    path: 'designer',
    component: StaticCircuitDesignerComponent
  }
  , {
    path: 'designer1/:id',
    component: GuidedCircuitDesignerComponent
  }
  , {
    path: 'designer1',
    component: GuidedCircuitDesignerComponent
  },
  {path: '**', redirectTo: ''},


];

@NgModule({
  declarations: [
    AppComponent,
    StoresComponent,
    CircuitComponent,
    AuthComponent,
    StaticCircuitDesignerComponent,
    StaticCircuitChallangerComponent,
    GuidedCircuitDesignerComponent,
    GuidedCircuitChallengerComponent,
    CallbackComponent,
  ],
  imports: [
    BrowserModule, HttpModule,
    RouterModule.forRoot(
      route
    )
  ],
  providers: [
    {
      provide: StoresService1,
      useClass: StoresService1,

    },
    {
      provide: CircuitsService,
      useClass: CircuitsService,
    }
    ,
    {
      provide: AuthService,
      useClass: AuthService,
    }
  ],
  bootstrap: [AppComponent]
})
export class AppModule {
}
